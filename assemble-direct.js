const { runFFmpeg, probeMediaDuration } = require('./utils/ffmpeg');
const fs = require('fs').promises;
const path = require('path');

const WORK = '/data/data/com.termux/files/home/Youtube/youtube-automation-agent/data/videos/compose_1788566917002';
const OUT = '/data/data/com.termux/files/home/Youtube/youtube-automation-agent/data/videos/prod_1788562371009_e0f465g33k_iirstuzahql_final.mp4';

async function main() {
  const clips = [];
  let offset = 0;
  const fade = 0.5;
  for (let i = 0; i < 10; i++) {
    const clip = path.join(WORK, `scene_${i}_cap.mp4`);
    const dur = await probeMediaDuration(clip);
    clips.push({ path: clip, duration: dur || 12 });
  }
  console.log('Durations:', clips.map(c => c.duration.toFixed(2)).join(', '));

  // Build single-pass xfade graph
  const inputs = clips.map(c => ['-i', c.path]).flat();
  const graph = [];
  let prev = '[0:v]';
  offset = clips[0].duration - fade;
  for (let i = 1; i < clips.length; i++) {
    const out = i === clips.length - 1 ? '[vout]' : `[vx${i}]`;
    graph.push(`${prev}[${i}:v]xfade=transition=fade:duration=${fade}:offset=${offset.toFixed(3)}${out}`);
    prev = out;
    offset += clips[i].duration - fade;
  }
  const visualPath = path.join(WORK, 'visual_track.mp4');
  await runFFmpeg([
    '-y', ...inputs,
    '-filter_complex', graph.join(';'),
    '-map', '[vout]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-r', '30', '-pix_fmt', 'yuv420p',
    visualPath
  ]);
  console.log('Visual track composed:', visualPath);

  // Mux narration
  const narration = path.join(WORK, 'narration_concat.m4a');
  const final = OUT;
  await runFFmpeg([
    '-y', '-i', visualPath, '-i', narration,
    '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-shortest',
    final
  ]);
  console.log('Final muxed:', final);
  const stats = await fs.stat(final);
  console.log('Size:', Math.round(stats.size/1024), 'KiB');
  console.log('Duration:', (await probeMediaDuration(final)).toFixed(2), 's');
}

main().catch(e => { console.error(e); process.exit(1); });
