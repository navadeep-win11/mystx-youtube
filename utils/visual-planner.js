/**
 * Visual Planner — turns narration into a coherent, license-safe visual plan.
 *
 * Design rules (platform spec):
 *  - Understand the WHOLE story before choosing any visual (scene queries are
 *    generated with full-script context, avoiding random-image compilations).
 *  - AI image generation is a FALLBACK, not the default. Stock/openly-licensed
 *    assets come first via the VisualSearchEngine.
 *  - Every planned visual carries source + license metadata for the manifest.
 *  - The planner never downloads arbitrary web images — only approved providers.
 */

const { Logger } = require('./logger');


const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'this', 'that', 'from', 'your', 'have', 'will', 'they', 'their', 'them', 'what', 'when', 'where', 'which', 'while', 'about', 'into', 'over', 'than', 'then', 'them', 'these', 'those', 'been', 'were', 'are', 'was', 'how', 'why', 'you', 'can', 'its', "it's", 'most', 'more', 'some', 'any', 'all', 'but', 'not', 'one', 'two', 'also', 'very', 'just', 'like', 'make', 'made', 'using', 'used', 'use', 'get', 'got']);

class VisualPlanner {
  constructor({ visualSearch, aiTextService, logger } = {}) {
    this.search = visualSearch || null;
    this.ai = aiTextService || null;
    this.logger = logger || new Logger('VisualPlanner');
  }

  /**
   * Build the per-scene visual plan.
   * @param {object} script  normalized script object (hook/introduction/mainContent/…)
   * @param {object} classification  output of ContentClassifier.classify()
   * @param {object} options  { productionId, orientation, usedHashes, usedAssetIds, maxScenes }
   * @returns {Promise<{scenes: Array, stats: object}>}
   */
  async plan(script, classification, options = {}) {
    const { scriptScenes } = require('./scene-repair-service');
    const blueprints = scriptScenes(script || {});
    if (!blueprints.length) return { scenes: [], stats: { total: 0, stock: 0, ai: 0, none: 0 } };

    const strategy = classification.visualStrategy || {};
    const orientation = options.orientation || (classification.aspectRatio === '9:16' ? 'portrait' : 'landscape');
    const queries = await this.buildSceneQueries(script, classification, blueprints);

    const usedHashes = options.usedHashes || new Set();
    const usedAssetIds = options.usedAssetIds || new Set();
    const scenes = [];
    const stats = { total: blueprints.length, stock: 0, ai: 0, none: 0 };

    for (const [position, scene] of blueprints.entries()) {
      const query = queries[position] || this.heuristicQuery(scene, classification, script);
      const wantVideo = this.sceneWantsVideo(position, blueprints.length, strategy);

      let asset = null;
      if (this.search) {
        asset = await this.search.acquireBest({
          query,
          mediaType: wantVideo ? 'any' : 'image',
          orientation,
          usedHashes,
          usedAssetIds,
          productionId: options.productionId,
          scenePosition: position
        });
      }

      if (asset) {
        stats.stock += 1;
        scenes.push({
          position,
          label: scene.label,
          scriptText: scene.scriptText,
          visualQuery: query,
          assetType: asset.assetType,
          assetPath: asset.assetPath,
          assetOrigin: 'stock',
          provider: asset.provider,
          providerAssetId: asset.providerAssetId,
          sourceUrl: asset.sourceUrl,
          pageUrl: asset.pageUrl,
          creator: asset.creator,
          license: asset.license,
          licenseUrl: asset.licenseUrl,
          attribution: asset.attribution,
          cacheHash: asset.cacheHash,
          width: asset.width,
          height: asset.height,
          durationSeconds: asset.durationSeconds,
          motion: this.motionForScene(position, strategy, asset.assetType),
          status: 'ready'
        });
        continue;
      }

      // No stock hit → leave a well-formed AI prompt; generation happens in
      // the production stage (AI image = fallback, per spec).
      stats.ai += 1;
      scenes.push({
        position,
        label: scene.label,
        scriptText: scene.scriptText,
        visualQuery: query,
        assetType: 'ai_image',
        assetPath: null,
        assetOrigin: 'ai_fallback',
        provider: null,
        license: null,
        aiPrompt: this.buildAiPrompt(scene, query, classification, orientation),
        motion: this.motionForScene(position, strategy, 'image'),
        status: 'needs_generation'
      });
    }

    return { scenes, stats };
  }

  /**
   * One stock-search query per scene, generated with FULL script context so
   * visuals form a coherent story (spec: Visual Storytelling).
   */
  async buildSceneQueries(script, classification, blueprints) {
    if (this.ai && typeof this.ai.isAvailable === 'function' && this.ai.isAvailable()) {
      try {
        return await this.aiQueries(script, classification, blueprints);
      } catch (error) {
        this.logger.warn('AI query generation failed; using keyword queries:', error.message);
      }
    }
    return blueprints.map(scene => this.heuristicQuery(scene, classification, script));
  }

  async aiQueries(script, classification, blueprints) {
    const storyline = blueprints.map((scene, i) => `SCENE ${i + 1} (${scene.label}): ${scene.scriptText.slice(0, 220)}`).join('\n');
    const prompt = `You are a stock-footage art director. For each scene of this video, write ONE short stock-media search query (2-4 CONCRETE NOUN words, e.g. "analyst computer screens", "server room blue lights", "hospital corridor night"). Queries must form a coherent visual story across scenes. Avoid abstract verbs. Never include on-screen text requests.

VIDEO TITLE: ${script.title}
CONTENT TYPE: ${classification.contentType}
STORYLINE:
${storyline}

Respond with ONLY a JSON array of ${blueprints.length} query strings, no markdown.`;

    const raw = await this.ai.generateText(prompt, { maxTokens: 400, temperature: 0.4 });
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('planner AI returned no JSON array');
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) throw new Error('planner AI JSON not an array');
    return parsed.map(q => String(q || '').replace(/["']/g, '').trim().slice(0, 80));
  }

  heuristicQuery(scene, classification, script = null) {
    const META_WORDS = new Set(['learn', 'exactly', 'everyone', 'welcome', 'channel', 'section', 'covers', 'important', 'aspects', 'minutes', 'today', 'going', 'take', 'look', 'next', 'few', 'back', 'cover', 'start', 'starts', 'often', 'hook', 'subscribe', 'watching', 'conclusion', 'recap', 'video', 'point', 'first', 'second', 'third', 'finally', 'thank', 'thanks', 'stay', 'tuned', 'incredible', 'amazing', 'let', 'gets', 'started', 'talk', 'talking', 'understand', 'understanding', 'explore', 'discover', 'story', 'behind', 'really', 'actually', 'basically', 'simply', 'little', 'lots', 'tons']);
    const extract = (text) => String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 3 && !STOP_WORDS.has(word) && !META_WORDS.has(word));

    // Distinctive content words of this scene; fall back to the video title's
    // keywords (template section prose is mostly meta-sentences).
    let topic = extract(scene.scriptText);
    if (topic.length < 2 && script) {
      topic = extract(`${script.title || ''} ${classification.contentType || ''}`);
    }
    if (topic.length < 2) topic = extract(String(classification.contentType || ''));

    const type = classification.typeId || 'explainer';
    const flavor = {
      cybersecurity: 'security technology',
      technology: 'technology',
      ai: 'artificial intelligence',
      news: 'newsroom',
      documentary: 'cinematic',
      travel: 'travel',
      finance: 'finance business',
      gaming: 'gaming',
      science: 'laboratory'
    }[type];

    // Stock search engines are AND/AND-ish: keep queries to 4-5 concrete terms.
    const query = [...topic.slice(0, 4), flavor].filter(Boolean).slice(0, 5).join(' ');
    return query || classification.contentType;
  }

  /** bRollRatio of scenes get video candidates (evenly distributed). */
  sceneWantsVideo(position, total, strategy) {
    const ratio = Number(strategy.bRollRatio || 0);
    if (ratio <= 0 || total <= 0) return false;
    const videoSlots = Math.max(1, Math.round(total * ratio));
    if (videoSlots >= total) return true;
    const stride = total / videoSlots;
    const wanted = new Set();
    for (let k = 0; k < videoSlots; k++) {
      wanted.add(Math.min(total - 1, Math.floor(k * stride + stride / 2)));
    }
    return wanted.has(position);
  }

  motionForScene(position, strategy, assetType) {
    const fallback = strategy.motionDefault || 'ken_burns';
    // Alternate direction/feel so consecutive scenes never move identically.
    const variants = {
      ken_burns: position % 2 === 0 ? 'zoom_in' : 'zoom_out',
      slow_ken_burns: position % 2 === 0 ? 'slow_zoom_in' : 'slow_pan_right',
      pan: position % 2 === 0 ? 'pan_right' : 'pan_left',
      zoom_in: position % 2 === 0 ? 'zoom_in' : 'slow_zoom_in',
      zoom_out: position % 2 === 0 ? 'zoom_out' : 'slow_zoom_in'
    };
    const base = variants[fallback] || (position % 2 === 0 ? fallback : 'slow_zoom_in');
    return assetType === 'stock_video' ? 'video_playback' : base;
  }

  buildAiPrompt(scene, query, classification, orientation) {
    const ratio = orientation === 'portrait' ? 'vertical 9:16 composition' : 'wide 16:9 composition';
    const styleByType = {
      documentary: 'cinematic documentary photography, natural light, film grain',
      news: 'photojournalistic, crisp, modern newsroom aesthetic',
      cybersecurity: 'dark tech aesthetic, blue and red accent lighting, shallow depth of field',
      technology: 'sleek product photography, clean studio light',
      storytelling: 'cinematic emotional photography, warm tones, shallow depth of field',
      horror_unsolved: 'moody cinematic, desaturated, high contrast shadows'
    };
    const style = styleByType[classification.typeId] || 'professional editorial photography, clean composition';
    return `${query}. ${scene.scriptText.slice(0, 160)}. ${style}, ${ratio}, no text, no captions, no watermarks, no logos`;
  }
}

module.exports = { VisualPlanner };
