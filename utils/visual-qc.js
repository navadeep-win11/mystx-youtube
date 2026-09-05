/**
 * Visual Quality Control — pre-render validation.
 *
 * Checks the visual plan, captions, narration timing and manifest metadata
 * BEFORE composition. Failed scenes are returned per-scene so the pipeline
 * can regenerate/replan ONLY the broken scene (never the whole video).
 */

const fs = require('fs').promises;
const { Logger } = require('./logger');

const MIN_DIMENSION = 480;
const KNOWN_LICENSES = new Set(['pexels license', 'pixabay content license', 'pixabay license', 'unsplash license', 'cc0', 'pdm', 'public domain']);

class VisualQC {
  constructor(options = {}) {
    this.logger = options.logger || new Logger('VisualQC');
  }

  /**
   * @param {object} plan { scenes: [...] } — visual plan from VisualPlanner
   * @param {object} timing { scenes: [{duration, audioPath}] } — narration timing
   * @returns {{ok:boolean, issues:Array, sceneIssues:Object, summary:object}}
   */
  async validatePlan(plan, timing = { scenes: [] }, options = {}) {
    const issues = [];
    const sceneIssues = {};
    const scenes = plan?.scenes || [];
    const summary = { scenes: scenes.length, stock: 0, ai: 0, missing: 0, duplicateAssets: 0, licenseMetadataComplete: 0 };

    const seenHashes = new Map();
    const seenPaths = new Map();

    for (const scene of scenes) {
      const local = [];
      const position = scene.position;

      if (scene.assetOrigin === 'stock') summary.stock += 1;
      if (scene.assetOrigin === 'ai_fallback') summary.ai += 1;
      if (!scene.assetPath && scene.status !== 'needs_generation') {
        local.push('missing_asset_file');
        summary.missing += 1;
      }
      if (scene.assetPath) {
        try {
          const stat = await fs.stat(scene.assetPath);
          if (!stat.isFile() || stat.size === 0) {
            local.push('broken_media');
            summary.missing += 1;
          }
        } catch (error) {
          local.push('missing_asset_file');
          summary.missing += 1;
        }
      }
      if (scene.assetPath) {
        if (seenPaths.has(scene.assetPath)) {
          local.push('duplicate_visual');
          summary.duplicateAssets += 1;
        }
        seenPaths.set(scene.assetPath, position);
        if (scene.cacheHash) {
          if (seenHashes.has(scene.cacheHash)) {
            local.push('duplicate_visual_hash');
            summary.duplicateAssets += 1;
          }
          seenHashes.set(scene.cacheHash, position);
        }
      }
      if (scene.assetOrigin === 'stock') {
        const required = ['provider', 'license'];
        const missingMeta = required.filter(field => !scene[field]);
        if (missingMeta.length) {
          local.push(`incomplete_license_metadata:${missingMeta.join('+')}`);
        } else {
          summary.licenseMetadataComplete += 1;
        }
        if (scene.license && !KNOWN_LICENSES.has(String(scene.license).toLowerCase()) && !/^(cc|pdm|public domain)/i.test(scene.license)) {
          local.push(`unrecognized_license:${scene.license}`);
        }
      }
      if (scene.width && scene.width < MIN_DIMENSION) local.push('low_resolution');
      if (scene.duration !== undefined && (scene.duration <= 0 || scene.duration > 120)) local.push('invalid_scene_duration');

      if (local.length) sceneIssues[position] = local;
    }

    // Narration timing cross-check
    if (Array.isArray(timing.scenes)) {
      timing.scenes.forEach((t, index) => {
        if (!t.duration || t.duration <= 0) {
          (sceneIssues[index] = sceneIssues[index] || []).push('narration_duration_missing');
        }
        if (t.audioPath && !t.realAudio) {
          (sceneIssues[index] = sceneIssues[index] || []).push('narration_estimated_not_measured');
        }
      });
    }

    // Duplicate caption events across scenes (each scene must have its own SRT)
    if (options.captionEvents) {
      for (const [index, events] of Object.entries(options.captionEvents)) {
        const texts = events.map(e => String(e.text).trim().toLowerCase());
        if (new Set(texts).size !== texts.length) {
          (sceneIssues[index] = sceneIssues[index] || []).push('duplicate_captions_within_scene');
        }
      }
    }

    const ok = Object.keys(sceneIssues).length === 0;
    return { ok, issues, sceneIssues, summary };
  }

  /** Human-readable QC report for the Review Studio. */
  formatReport(result) {
    const lines = [`Visual QC: ${result.ok ? 'PASS' : 'FAIL'} — ${result.summary.scenes} scenes (${result.summary.stock} stock, ${result.summary.ai} AI-fallback)`];
    for (const [position, list] of Object.entries(result.sceneIssues)) {
      lines.push(`  scene ${position}: ${list.join(', ')}`);
    }
    if (result.summary.duplicateAssets) lines.push(`  duplicate assets: ${result.summary.duplicateAssets}`);
    return lines.join('\n');
  }
}

module.exports = { VisualQC };
