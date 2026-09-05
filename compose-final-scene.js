const fs = require('fs').promises;
const path = require('path');
const { ProfessionalCompositor } = require('./utils/compositor');
const { probeMediaDuration } = require('./utils/ffmpeg');

const PID = 'prod_1788608376536_2v9vo4wyoxf_n3e1pb82xpp';
const WORK = path.join('data/videos/compose_1788608618308');

(async () => {
  const manifest = JSON.parse(await fs.readFile(path.join('data/asset-manifests', PID + '.json'), 'utf8'));
  const scene9 = manifest.scenes[9];
  const slice = path.join('data/audio/scenes', PID, '009_base.mp3');
  const duration = await probeMediaDuration(slice);
  console.log('scene 9: label=' + scene9.label, 'slice=' + duration + 's');

  const compositor = new ProfessionalCompositor({});
  const canvas = compositor.canvasFor('16:9');
  const clip = await compositor.renderSceneClip({
    assetPath: scene9.assetPath || null,
    assetType: 'stock_image',
    motion: scene9.motion || 'zoom_in',
    label: scene9.label,
    title: null,
    narrationAudioPath: slice,
    duration: Number(duration.toFixed(2)),
    captionSrtPath: path.join('data/captions', PID, 'scene_009.srt'),
    editingStyle: { overlays: ['number_badge', 'progress_bar', 'source_card'], accent: 'rank-gold', titleCards: 'cinematic' },
    overlayData: { itemNumber: 5 }
  }, { index: 9, canvas, workDir: WORK, aspectRatio: '16:9', total: 10 });
  console.log('scene 9 rendered:', clip);
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
