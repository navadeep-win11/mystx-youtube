const { runFFmpeg, probeMediaDuration } = require('./utils/ffmpeg');
const fs = require('fs').promises;
const path = require('path');
const WORK = 'data/videos/compose_1788608618308';
const OUT = 'data/videos/prod_1788608376536_2v9vo4wyoxf_n3e1pb82xpp_final.mp4';

(async () => {
  const clips = [];
  for (let i = 0; i < 10; i++) {
    const p = path.join(WORK, `scene_${String(i).padStart(3, '0')}.mp4`);
    clips.push({ path: p, duration: await probeMediaDuration(p) || 12 });
  }
  const fade = 0.5;
  const inputs = clips.flatMap(c => ['-i', c.path]);
  const graph = [];
  let prev = '[0:v]';
  let offset = clips[0].duration - fade;
  for (let i = 1; i < clips.length; i++) {
    const out = i === clips.length - 1 ? '[vout]' : `[vx${i}]`;
    graph.push(`${prev}[${i}:v]xfade=transition=fade:duration=${fade}:offset=${offset.toFixed(3)}${out}`);
    prev = out;
    offset += clips[i].duration - fade;
  }
  const visualPath = path.join(WORK, 'visual_track.mp4');
  await runFFmpeg(['-y', ...inputs, '-filter_complex', graph.join(';'), '-map', '[vout]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-r', '30', '-pix_fmt', 'yuv420p', visualPath]);
  console.log('visual track done');
  await runFFmpeg(['-y', '-i', visualPath, '-i', path.join(WORK, 'narration_concat.m4a'),
    '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-shortest', OUT]);
  const stats = await fs.stat(OUT);
  console.log('FINAL:', OUT, Math.round(stats.size / 1024) + 'KiB', (await probeMediaDuration(OUT)).toFixed(2) + 's');
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
