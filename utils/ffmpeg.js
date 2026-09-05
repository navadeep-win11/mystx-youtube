const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

let cachedPath = null;

/**
 * Resolve the FFmpeg binary to use, in order of preference:
 * 1. FFMPEG_PATH environment variable
 * 2. Bundled binary from the optional ffmpeg-static package
 * 3. `ffmpeg` on the system PATH
 */
function getFFmpegPath() {
  if (cachedPath) {
    return cachedPath;
  }

  if (process.env.FFMPEG_PATH) {
    cachedPath = process.env.FFMPEG_PATH;
    return cachedPath;
  }

  try {
    cachedPath = require('ffmpeg-static');
  } catch (error) {
    cachedPath = null;
  }

  cachedPath = cachedPath || 'ffmpeg';
  return cachedPath;
}

async function checkFFmpeg() {
  try {
    await execFileAsync(getFFmpegPath(), ['-version']);
    return true;
  } catch (error) {
    return false;
  }
}

async function runFFmpeg(args) {
  return execFileAsync(getFFmpegPath(), args, { maxBuffer: 32 * 1024 * 1024 });
}

function ffmpegInstallHint() {
  const hints = {
    win32: 'winget install Gyan.FFmpeg (then restart your terminal)',
    darwin: 'brew install ffmpeg',
    linux: 'sudo apt install ffmpeg (or your distro equivalent)'
  };

  const platformHint = hints[process.platform] || 'https://ffmpeg.org/download.html';
  return `FFmpeg not found. Install it with: ${platformHint} — or run "npm install" again to fetch the bundled ffmpeg-static binary, or set FFMPEG_PATH to your ffmpeg executable.`;
}


/**
 * Probe a media file's duration in seconds using ffprobe (falls back to
 * parsing `ffmpeg -i` output when ffprobe is unavailable).
 * Returns null when the duration cannot be measured.
 */
async function probeMediaDuration(mediaPath) {
  const fs = require('fs').promises;
  try {
    const stat = await fs.stat(mediaPath);
    if (!stat.isFile() || stat.size === 0) return null;
  } catch (error) {
    return null;
  }

  try {
    const ffprobePath = getFFmpegPath().replace(/ffmpeg$/, 'ffprobe');
    const { stdout } = await execFileAsync(ffprobePath, [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', String(mediaPath)
    ], { maxBuffer: 1024 * 1024 });
    const value = parseFloat(String(stdout).trim());
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch (error) {
    // ffprobe missing or failed — parse ffmpeg's own stderr report.
    try {
      let stderr = '';
      try {
        await execFileAsync(getFFmpegPath(), ['-i', String(mediaPath)], { maxBuffer: 1024 * 1024 });
      } catch (probeError) {
        stderr = String(probeError.stderr || '');
      }
      const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
      if (match) {
        return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(`0.${match[4]}`);
      }
    } catch (fallbackError) { /* nothing more to try */ }
    return null;
  }
}

module.exports = { getFFmpegPath, checkFFmpeg, runFFmpeg, probeMediaDuration, ffmpegInstallHint };
