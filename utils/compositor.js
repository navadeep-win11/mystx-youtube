/**
 * Professional Compositor — assembles per-scene clips into a finished video.
 *
 * Scene model (from the visual plan + narration timing):
 *   background  = stock video (normalized, muted) | image with camera motion
 *   overlays    = lower thirds / number badges / progress / source & alert cards
 *   captions    = ONE validated caption layer burned via libass (scene-local SRT)
 *   transitions = xfade chain for smooth styles, hard cuts for fast styles
 *
 * Canvas: 16:9 (1920x1080), 9:16 (1080x1920), 1:1 (1080x1080).
 * Everything is FFmpeg + sharp — no headless browser, Termux-safe.
 */

const fs = require('fs').promises;
const path = require('path');
const sharp = require('sharp');
const { Logger } = require('./logger');
const { runFFmpeg } = require('./ffmpeg');

const CANVAS = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 }
};

const MOTION = {
  zoom_in: { z: 'min(zoom+0.00035,1.09)', x: 'iw/2-(iw/zoom/2)', y: 'ih/2-(ih/zoom/2)' },
  zoom_out: { z: 'if(lte(zoom,1.0),1.09,max(1.001,zoom-0.00035))', x: 'iw/2-(iw/zoom/2)', y: 'ih/2-(ih/zoom/2)' },
  pan_right: { z: '1.12', x: '(iw-iw/zoom)*on/{frames}', y: 'ih/2-(ih/zoom/2)' },
  pan_left: { z: '1.12', x: '(iw-iw/zoom)*(1-on/{frames})', y: 'ih/2-(ih/zoom/2)' },
  slow_zoom_in: { z: 'min(zoom+0.00018,1.05)', x: 'iw/2-(iw/zoom/2)', y: 'ih/2-(ih/zoom/2)' },
  slow_pan_right: { z: '1.08', x: '(iw-iw/zoom)*(t/{dur})', y: 'ih/2-(ih/zoom/2)' }
};

class ProfessionalCompositor {
  constructor(options = {}) {
    this.logger = options.logger || new Logger('Compositor');
    this.cacheDir = options.cacheDir || null; // per-scene clip cache
    this.musicPath = options.musicPath || null; // operator-provided licensed music
    this.musicVolume = options.musicVolume || 0.14;
  }

  canvasFor(aspectRatio) {
    return CANVAS[aspectRatio] || CANVAS['16:9'];
  }

  escapeFilterPath(p) {
    return String(p).replace(/\\/g, '/').replace(/:/g, '\\:');
  }

  /**
   * Compose the full production.
   * @param {object} plan { scenes: [{assetPath, assetType, motion, label, title,
   *   narrationAudioPath, duration, captionEvents, editingStyle, overlayData}],
   *   aspectRatio, transition, outputPath, title, totalScenes }
   */
  async compose(plan) {
    const canvas = this.canvasFor(plan.aspectRatio);
    const workDir = path.join(path.dirname(plan.outputPath), 'compose_' + Date.now());
    await fs.mkdir(workDir, { recursive: true });
    const sceneClips = [];

    // Narration/visual alignment for crossfaded timelines: every non-final
    // scene is rendered one fade-length longer, so the xfade overlap borrows
    // from the extension instead of shrinking the visual track. The composed
    // duration then equals the sum of narration-driven scene durations and
    // scene k still starts exactly where its narration slice starts.
    const transition = plan.transition || 'crossfade';
    const willXfade = ['crossfade', 'fade'].includes(transition) && plan.scenes.length > 1;
    if (willXfade) {
      const baseDurations = plan.scenes.map(s => Math.max(1.5, Number(s.duration || 4)));
      const fade = Math.min(0.5, ...baseDurations.map(d => d / 4));
      plan.scenes.forEach((scene, i) => {
        scene.duration = i < plan.scenes.length - 1 ? baseDurations[i] + fade : baseDurations[i];
      });
    }

    try {
      for (const [index, scene] of plan.scenes.entries()) {
        const clipPath = await this.renderSceneClip(scene, {
          index, canvas, workDir, aspectRatio: plan.aspectRatio, total: plan.scenes.length
        });
        sceneClips.push(clipPath);
      }

      const visualPath = await this.assembleVisualTrack(sceneClips, plan, workDir, canvas);
      await this.muxNarration(visualPath, plan, workDir, canvas);
      const stats = await fs.stat(plan.outputPath);
      if (!stats.size || stats.size < 10 * 1024) throw new Error('composed output suspiciously small');

      this.logger.info(`Composed ${plan.scenes.length} scenes → ${plan.outputPath} (${Math.round(stats.size / 1024)} KiB)`);
      return { outputPath: plan.outputPath, sceneClips, sizeBytes: stats.size };
    } finally {
      await this.cleanup(workDir);
    }
  }

  /** Render ONE scene clip: background + motion + overlays + burned captions. */
  async renderSceneClip(scene, { index, canvas, workDir, aspectRatio, total }) {
    const duration = Math.max(1.5, Number(scene.duration || 4));
    const clipPath = path.join(workDir, `scene_${String(index).padStart(3, '0')}.mp4`);

    // 1. Background — a broken/undecodable asset degrades to the gradient
    // background instead of failing the whole production.
    const bgPath = path.join(workDir, `bg_${index}.mp4`);
    let backgroundRendered = false;
    if (scene.assetType === 'stock_video' && scene.assetPath) {
      try {
        await this.normalizeStockVideo(scene.assetPath, bgPath, duration, canvas, aspectRatio);
        backgroundRendered = true;
      } catch (error) {
        this.logger.warn(`Stock video normalization failed for scene ${index}; using image/gradient fallback: ${error.message.split('\n')[0]}`);
      }
    }
    if (!backgroundRendered && scene.assetPath) {
      try {
        await this.renderImageBackground(scene.assetPath, bgPath, duration, canvas, scene.motion || 'zoom_in', aspectRatio);
        backgroundRendered = true;
      } catch (error) {
        this.logger.warn(`Image background failed for scene ${index} (${path.basename(String(scene.assetPath))}); using gradient: ${error.message.split('\n')[0]}`);
      }
    }
    if (!backgroundRendered) {
      await this.renderGradientBackground(bgPath, duration, canvas, scene.editingStyle?.accent);
    }

    // 2. Overlays (SVG → PNG → ffmpeg overlay)
    const overlaySpecs = this.buildOverlaySpecs(scene, { index, total, canvas, duration });
    let current = bgPath;
    let overlayIndex = 0;
    for (const spec of overlaySpecs) {
      const pngPath = path.join(workDir, `ov_${index}_${overlayIndex}.png`);
      await sharp(Buffer.from(spec.svg)).png().toFile(pngPath);
      const next = path.join(workDir, `scene_${index}_o${overlayIndex}.mp4`);
      const fadeIn = spec.fade ? `,fade=t=in:st=0:d=0.5:alpha=1` : '';
      const fadeOut = spec.fade ? `,fade=t=out:st=${Math.max(0, duration - 0.6).toFixed(2)}:d=0.6:alpha=1` : '';
      await runFFmpeg([
        '-y', '-i', current, '-loop', '1', '-t', duration.toFixed(2), '-i', pngPath,
        '-filter_complex', `[1:v]format=rgba${fadeIn}${fadeOut}[ov];[0:v][ov]overlay=${spec.x}:${spec.y}:format=auto`,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-r', '30', next
      ]);
      current = next;
      overlayIndex += 1;
    }

    // 3. Burned captions — single validated text layer (libass).
    if (scene.captionSrtPath) {
      const captioned = path.join(workDir, `scene_${index}_cap.mp4`);
      const style = this.libassStyle(aspectRatio);
      await runFFmpeg([
        '-y', '-i', current,
        '-vf', `subtitles='${this.escapeFilterPath(scene.captionSrtPath)}':force_style='${style}'`,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', '-r', '30', captioned
      ]);
      current = captioned;
    }

    // Normalize the final scene clip (uniform codec for concat).
    if (current !== clipPath) {
      await runFFmpeg(['-y', '-i', current, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-r', '30', '-an', clipPath]);
    }
    return clipPath;
  }

  async renderImageBackground(imagePath, outputPath, duration, canvas, motion, _aspectRatio) {
    // Pre-scale the still to give the camera room to move, then zoompan.
    const overscan = 1.25;
    const srcW = Math.round(canvas.width * overscan);
    const srcH = Math.round(canvas.height * overscan);
    const pre = path.join(path.dirname(outputPath), 'pre_' + path.basename(outputPath));
    await sharp(imagePath)
      .resize(srcW, srcH, { fit: 'cover', position: 'centre' })
      .jpeg({ quality: 90 })
      .toFile(pre);

    const params = MOTION[motion] || MOTION.zoom_in;
    const frames = Math.round(duration * 30);
    const xExpr = params.x.replace(/\{frames\}/g, String(frames)).replace(/\{dur\}/g, duration.toFixed(2));
    const zExpr = params.z.replace(/\{frames\}/g, String(frames)).replace(/\{dur\}/g, duration.toFixed(2));

    await runFFmpeg([
      '-y', '-loop', '1', '-t', duration.toFixed(2), '-i', pre,
      '-vf', `zoompan=z='${zExpr}':x='${xExpr}':y='${yExprExpr(params, duration)}':d=${frames}:s=${canvas.width}x${canvas.height}:fps=30,format=yuv420p`,
      '-t', duration.toFixed(2),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-r', '30', outputPath
    ]);
    await fs.unlink(pre).catch(() => {});
  }

  async normalizeStockVideo(videoPath, outputPath, duration, canvas, _aspectRatio) {
    // Cover-crop the stock clip, mute it, trim to the narration-driven duration.
    const filters = [
      `scale=${canvas.width}:${canvas.height}:force_original_aspect_ratio=increase`,
      `crop=${canvas.width}:${canvas.height}`,
      'format=yuv420p'
    ].join(',');
    await runFFmpeg([
      '-y', '-i', videoPath, '-t', duration.toFixed(2),
      '-vf', filters, '-an', '-r', '30',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', outputPath
    ]);
  }

  async renderGradientBackground(outputPath, duration, canvas, _accent) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}">
      <defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#1a2340"/><stop offset="100%" stop-color="#3d2b5e"/>
      </linearGradient></defs>
      <rect width="100%" height="100%" fill="url(#g)"/></svg>`;
    const png = path.join(path.dirname(outputPath), `grad_${Date.now()}.png`);
    await sharp(Buffer.from(svg)).png().toFile(png);
    await this.renderImageBackground(png, outputPath, duration, canvas, 'slow_zoom_in', '16:9');
    await fs.unlink(png).catch(() => {});
  }

  /** Overlay cards driven by the content-type editing style. */
  buildOverlaySpecs(scene, { index, total, canvas, _duration }) {
    const specs = [];
    const style = scene.editingStyle || {};
    const overlays = style.overlays || [];
    const safeMargin = Math.round(canvas.width * 0.05);

    // Title card on the opening scene (never duplicated with captions).
    if (index === 0 && scene.title && style.titleCards !== 'none') {
      const svg = this.titleCardSvg(scene.title, style.accent, canvas);
      specs.push({ svg, x: '(main_w-overlay_w)/2', y: '(main_h-overlay_h)/2', fade: true });
    }

    if (overlays.includes('progress') && total > 1) {
      const svg = this.progressBarSvg(index, total, canvas);
      specs.push({ svg, x: `(main_w-overlay_w)/2`, y: `${canvas.height - Math.round(canvas.height * 0.045)}`, fade: false });
    }

    if (overlays.includes('number_badge') && scene.overlayData?.itemNumber) {
      const svg = this.numberBadgeSvg(scene.overlayData.itemNumber, style.accent);
      specs.push({ svg, x: `${safeMargin}`, y: `${Math.round(canvas.height * 0.08)}`, fade: true });
    }

    if ((overlays.includes('lower_third') || overlays.includes('source_card') || overlays.includes('location_card') || overlays.includes('step_card')) && scene.label) {
      const svg = this.lowerThirdSvg(scene.label, style.accent, canvas);
      specs.push({ svg, x: `${safeMargin}`, y: `${canvas.height - Math.round(canvas.height * 0.18) - Math.round(canvas.height * 0.12)}`, fade: true });
    }

    return specs;
  }

  titleCardSvg(title, accent, canvas) {
    const width = Math.round(canvas.width * 0.8);
    const fontSize = Math.round(canvas.width * 0.052);
    const lines = String(title).split(/(.{1,34})(?:\s|$)/).filter(Boolean).slice(0, 3);
    const height = lines.length * Math.round(fontSize * 1.3) + Math.round(canvas.height * 0.12);
    const text = lines.map((line, i) =>
      `<text x="50%" y="${Math.round(height * 0.52) + i * Math.round(fontSize * 1.3)}" font-family="DejaVu Sans" font-size="${fontSize}" font-weight="bold" fill="#ffffff" text-anchor="middle">${line.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`
    ).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <rect width="100%" height="100%" rx="18" fill="rgba(8,10,18,0.55)"/>
      <rect x="0" y="${height - 6}" width="100%" height="6" fill="${this.accentColor(accent)}"/>
      ${text}</svg>`;
  }

  lowerThirdSvg(label, accent, canvas) {
    const fontSize = Math.round(canvas.width * 0.024);
    const clean = String(label).slice(0, 46);
    const width = Math.min(canvas.width - 2 * Math.round(canvas.width * 0.05), clean.length * fontSize * 0.62 + fontSize * 2);
    const height = Math.round(fontSize * 2.4);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <rect width="100%" height="100%" rx="10" fill="rgba(8,10,18,0.62)"/>
      <rect x="0" y="0" width="6" height="100%" fill="${this.accentColor(accent)}"/>
      <text x="${Math.round(fontSize * 0.8)}" y="${Math.round(height * 0.66)}" font-family="DejaVu Sans" font-size="${fontSize}" fill="#ffffff">${clean.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text></svg>`;
  }

  numberBadgeSvg(number, accent) {
    const size = 96;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
      <circle cx="48" cy="48" r="44" fill="${this.accentColor(accent)}"/>
      <text x="48" y="64" font-family="DejaVu Sans" font-size="52" font-weight="bold" fill="#0b0b12" text-anchor="middle">${Number(number) || ''}</text></svg>`;
  }

  progressBarSvg(index, total, canvas) {
    const width = Math.round(canvas.width * 0.6);
    const height = 8;
    const fill = Math.round(((index + 1) / total) * width);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <rect width="100%" height="100%" rx="4" fill="rgba(255,255,255,0.22)"/>
      <rect width="${fill}" height="100%" rx="4" fill="rgba(255,255,255,0.85)"/></svg>`;
  }

  accentColor(accent) {
    const map = {
      'news-red': '#e53935', 'sec-red': '#ff5252', 'rank-gold': '#f6b73c', 'pop-yellow': '#ffd54f',
      'tech-cyan': '#26c6da', 'ai-violet': '#7c4dff', 'lab-green': '#66bb6a', 'money-green': '#43a047',
      'review-orange': '#fb8c00', 'app-blue': '#42a5f5', 'guide-green': '#4caf50', 'warn-amber': '#ffb300',
      'film-teal': '#26a69a', 'noir': '#9e9e9e', 'blood-dark': '#b71c1c', 'neon': '#00e5ff',
      'sunset': '#ff7043', 'dawn-gold': '#ffca28', 'duo-split': '#ab47bc', 'editorial-navy': '#3949ab',
      'case-blue': '#1e88e5', 'host-red': '#ef5350', 'shorts-neon': '#ff005d', 'trend-purple': '#8e24aa',
      'warm-film': '#ff8a65', 'trust-blue': '#1e88e5', 'deep-indigo': '#5c6bc0', 'cinematic': '#455a64',
      'vibrant': '#d500f9', 'alert': '#e53935', 'bold': '#fdd835', 'neutral': '#90a4ae'
    };
    return map[accent] || '#4a90d9';
  }

  libassStyle(aspectRatio) {
    const fontSize = aspectRatio === '9:16' ? 15 : 13;
    const marginV = aspectRatio === '9:16' ? Math.round(300) : Math.round(72);
    return `FontName=DejaVu Sans,FontSize=${fontSize},Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H90000000,BorderStyle=4,Outline=1.4,Shadow=0,Alignment=2,MarginV=${marginV},Spacing=0.4`;
  }

  /** Chain clips with xfade (smooth styles) or concat (fast styles). */
  async assembleVisualTrack(sceneClips, plan, workDir, _canvas) {
    const visualPath = path.join(workDir, 'visual_track.mp4');
    const transition = plan.transition || 'crossfade';
    const useXfade = ['crossfade', 'fade'].includes(transition) && sceneClips.length > 1;

    if (!useXfade) {
      const listPath = path.join(workDir, 'concat.txt');
      await fs.writeFile(listPath, sceneClips.map(c => `file '${c.replace(/'/g, "'\\''")}'`).join('\n'), 'utf8');
      await runFFmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', visualPath]);
      return visualPath;
    }

    // Probe each clip for exact durations to compute xfade offsets.
    const durations = [];
    for (const clip of sceneClips) durations.push(await this.probeDuration(clip) || 4);
    const fade = Math.min(0.5, ...durations.map(d => d / 4));

    // Single-pass chained xfade graph: every scene joins the graph once, so
    // the whole visual track is encoded exactly once (O(n), not O(n²)).
    const args = ['-y'];
    for (const clip of sceneClips) args.push('-i', clip);
    const graph = [];
    let prev = '[0:v]';
    let offset = durations[0] - fade;
    for (let i = 1; i < sceneClips.length; i++) {
      const out = i === sceneClips.length - 1 ? '[vout]' : `[vx${i}]`;
      graph.push(`${prev}[${i}:v]xfade=transition=fade:duration=${fade.toFixed(2)}:offset=${offset.toFixed(2)}${out}`);
      prev = out;
      offset += durations[i] - fade;
    }
    args.push('-filter_complex', graph.join(';'), '-map', '[vout]',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-r', '30', visualPath);
    await runFFmpeg(args);
    return visualPath;
  }

  /** Mix narration (scene-concatenated) + optional ducked music under the visual track. */
  async muxNarration(visualPath, plan, workDir, _canvas) {
    const narrationParts = plan.scenes.map(s => s.narrationAudioPath).filter(Boolean);
    let mixedAudio = null;

    if (narrationParts.length === plan.scenes.length && plan.scenes.length > 0) {
      // Exact per-scene narration concat — narration drives the timeline.
      const listPath = path.join(workDir, 'narration.txt');
      await fs.writeFile(listPath, narrationParts.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'), 'utf8');
      mixedAudio = path.join(workDir, 'narration_concat.m4a');
      await runFFmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c:a', 'aac', '-b:a', '160k', mixedAudio]);
    } else if (plan.narrationAudioPath) {
      mixedAudio = plan.narrationAudioPath;
    }

    const args = ['-y', '-i', visualPath];
    let filter = '[0:v]format=yuv420p[v]';
    if (mixedAudio && this.musicPath) {
      args.push('-i', mixedAudio, '-stream_loop', '-1', '-i', this.musicPath, '-t', plan.totalDuration ? plan.totalDuration.toFixed(2) : null);
      filter = `[0:v]format=yuv420p[v];[2:a]volume=${this.musicVolume},afade=t=in:d=1.5[m]` +
        `;[m][1:a]sidechaincompress=threshold=0.03:ratio=8:attack=80:release=600[ducked]` +
        `;[ducked]afade=t=out:st=${Math.max(0, (plan.totalDuration || 60) - 2).toFixed(2)}:d=2[aud]`;
      args.push('-filter_complex', filter, '-map', '[v]', '-map', '[aud]');
    } else if (mixedAudio) {
      args.push('-i', mixedAudio);
      args.push('-filter_complex', filter, '-map', '[v]', '-map', '1:a:0');
    } else {
      args.push('-filter_complex', filter, '-map', '[v]');
    }

    args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '22', '-pix_fmt', 'yuv420p', '-r', '30');
    if (mixedAudio) args.push('-c:a', 'aac', '-b:a', '160k', '-shortest');
    args.push(plan.outputPath);

    const cleanArgs = args.filter(a => a !== null && a !== undefined);
    await runFFmpeg(cleanArgs);
  }

  async probeDuration(mediaPath) {
    try {
      const { execFile } = require('child_process');
      const { promisify } = require('util');
      const { stdout } = await promisify(execFile)('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', String(mediaPath)]);
      const value = parseFloat(String(stdout).trim());
      return Number.isFinite(value) && value > 0 ? value : null;
    } catch (error) {
      return null;
    }
  }

  async cleanup(workDir) {
    try {
      const entries = await fs.readdir(workDir);
      await Promise.all(entries.map(e => fs.unlink(path.join(workDir, e)).catch(() => {})));
      await fs.rmdir(workDir).catch(() => {});
    } catch (error) { /* nothing to clean */ }
  }
}

function yExprExpr(params, duration) {
  return params.y.replace(/\{dur\}/g, duration.toFixed(2));
}

module.exports = { ProfessionalCompositor, CANVAS, MOTION };
