/**
 * Background Removal — pluggable provider abstraction (Termux-safe).
 *
 * Provider chain (first available wins):
 *   1. removebg  — REMOVEBG_API_KEY (cloud API, best quality)
 *   2. uniform   — local sharp-based uniform-background keying: samples the
 *                  border colors and makes similar pixels transparent. Works
 *                  well for product/object shots on plain backgrounds; a real
 *                  model-based provider (rembg/ONNX) can be added later via
 *                  the same interface.
 *   3. none      — passthrough (composition proceeds without cutout)
 */

const fs = require('fs').promises;
const sharp = require('sharp');
const { Logger } = require('./logger');

class BackgroundRemovalProvider {
  constructor(options = {}) {
    this.logger = options.logger || new Logger('BgRemoval');
    this.removeBgKey = options.removeBgKey || process.env.REMOVEBG_API_KEY || null;
  }

  id() {
    if (this.removeBgKey) return 'removebg';
    return 'uniform';
  }

  /**
   * Remove the background of an image.
   * @returns {Promise<{ok:boolean, outputPath:string, provider:string, method:string, removed:boolean, reason?:string}>}
   */
  async removeBackground(imagePath, outputPath, options = {}) {
    if (this.removeBgKey) {
      try {
        return await this.viaRemoveBg(imagePath, outputPath);
      } catch (error) {
        this.logger.warn('remove.bg failed, falling back to local keying:', error.message);
      }
    }
    return this.viaUniformKey(imagePath, outputPath, options);
  }

  async viaRemoveBg(imagePath, outputPath) {
    const axios = require('axios');
    const FormData = require('form-data');
    const form = new FormData();
    form.append('image_file', await fs.readFile(imagePath), { filename: 'input.png' });
    form.append('size', 'auto');
    const response = await axios.post('https://api.remove.bg/v1.0/removebg', form, {
      responseType: 'arraybuffer',
      headers: { ...form.getHeaders(), 'X-Api-Key': this.removeBgKey },
      timeout: 30000
    });
    const buffer = Buffer.from(response.data);
    await sharp(buffer).png().toFile(outputPath);
    return { ok: true, outputPath, provider: 'removebg', method: 'ai-matting', removed: true };
  }

  /**
   * Local uniform-background keying:
   *  - sample the four border regions to estimate the background color,
   *  - build an alpha mask that fades out pixels near that color,
   *  - feather the mask slightly so edges stay natural.
   */
  async viaUniformKey(imagePath, outputPath, options = {}) {
    try {
      const tolerance = options.tolerance ?? 42;
      const image = sharp(imagePath);
      const meta = await image.metadata();
      const maxDim = 1600; // keep memory bounded on-device
      const scale = Math.min(1, maxDim / Math.max(meta.width || maxDim, meta.height || maxDim));
      const width = Math.max(1, Math.round((meta.width || maxDim) * scale));
      const height = Math.max(1, Math.round((meta.height || maxDim) * scale));

      const { data, info } = await image.resize(width, height, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const px = info.width;
      const py = info.height;
      const channels = info.channels;

      // Estimate background from border pixels (top + bottom strips).
      let br = 0, bg = 0, bb = 0, count = 0;
      const strip = Math.max(1, Math.round(py * 0.02));
      for (let x = 0; x < px; x++) {
        for (const y of [0, 1, py - 2, py - 1]) {
          if (y < 0 || y >= py) continue;
          if (y < strip || y >= py - strip) {
            const o = (y * px + x) * channels;
            br += data[o]; bg += data[o + 1]; bb += data[o + 2]; count++;
          }
        }
      }
      if (!count) return { ok: false, outputPath, provider: 'uniform', method: 'uniform-key', removed: false, reason: 'no border pixels' };
      br /= count; bg /= count; bb /= count;

      // Uniformity check: if borders vary wildly, this image has no uniform
      // background and keying would butcher it — refuse honestly.
      let variance = 0;
      for (let x = 0; x < px; x += 7) {
        for (const y of [0, py - 1]) {
          const o = (y * px + x) * channels;
          variance += Math.abs(data[o] - br) + Math.abs(data[o + 1] - bg) + Math.abs(data[o + 2] - bb);
        }
      }
      variance /= Math.max(1, Math.floor(px / 7) * 2);
      if (variance > 60) {
        return { ok: false, outputPath, provider: 'uniform', method: 'uniform-key', removed: false, reason: 'background is not uniform enough for local keying' };
      }

      const output = Buffer.alloc(px * py * 4);
      for (let i = 0; i < px * py; i++) {
        const o = i * channels;
        const dist = Math.sqrt(
          (data[o] - br) ** 2 + (data[o + 1] - bg) ** 2 + (data[o + 2] - bb) ** 2
        );
        // alpha: 0 at dist<=tolerance*0.5, 1 at dist>=tolerance*1.5, feathered between
        let alpha = (dist - tolerance * 0.5) / (tolerance);
        alpha = Math.max(0, Math.min(1, alpha));
        output[i * 4] = data[o];
        output[i * 4 + 1] = data[o + 1];
        output[i * 4 + 2] = data[o + 2];
        output[i * 4 + 3] = Math.round(alpha * 255);
      }

      await sharp(output, { raw: { width: px, height: py, channels: 4 } })
        .png()
        .toFile(outputPath);

      return { ok: true, outputPath, provider: 'uniform', method: 'uniform-key', removed: true, tolerance };
    } catch (error) {
      return { ok: false, outputPath, provider: 'uniform', method: 'uniform-key', removed: false, reason: error.message };
    }
  }
}

module.exports = { BackgroundRemovalProvider };
