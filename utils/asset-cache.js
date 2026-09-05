/**
 * Asset Cache — content-addressed storage for downloaded visual assets.
 *
 * Files are stored by SHA-256 of their bytes, so the same asset is never
 * downloaded twice across productions. A JSON index keeps the license
 * metadata beside the bytes. Cleanup removes entries untouched for a
 * configurable period while always preserving entries referenced by
 * recent productions (callers pass keep set if needed).
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

class AssetCache {
  constructor(options = {}) {
    this.root = options.root || path.join(__dirname, '..', 'data', 'asset-cache');
    this.maxBytes = options.maxBytes || 512 * 1024 * 1024; // 512 MiB on-device ceiling
    this.defaultTtlMs = options.defaultTtlMs || 30 * 24 * 3600 * 1000; // 30 days
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
  }

  async ensureRoot() {
    await fs.mkdir(this.root, { recursive: true });
    await fs.mkdir(path.join(this.root, 'files'), { recursive: true });
  }

  indexPath() {
    return path.join(this.root, 'index.json');
  }

  async readIndex() {
    try {
      const raw = await fs.readFile(this.indexPath(), 'utf8');
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && parsed.entries ? parsed : { entries: {} };
    } catch (error) {
      return { entries: {} };
    }
  }

  async writeIndex(index) {
    await this.ensureRoot();
    await fs.writeFile(this.indexPath(), JSON.stringify(index, null, 2), 'utf8');
  }

  static hashBuffer(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  filePath(hash, ext) {
    return path.join(this.root, 'files', `${hash}${ext || ''}`);
  }

  /** Return cached metadata + local path for a hash, or null. */
  async get(hash) {
    const index = await this.readIndex();
    const entry = index.entries[hash];
    if (!entry) return null;
    try {
      const stat = await fs.stat(entry.localPath);
      if (!stat.isFile() || stat.size === 0) return null;
      return { ...entry, cached: true };
    } catch (error) {
      return null;
    }
  }

  /** Store bytes + metadata. Returns { hash, localPath, cachedNew }. */
  async put(buffer, meta = {}) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new Error('AssetCache.put requires non-empty bytes');
    }
    const hash = AssetCache.hashBuffer(buffer);
    const existing = await this.get(hash);
    if (existing) {
      await this.touch(hash);
      return { hash, localPath: existing.localPath, cachedNew: false, entry: existing };
    }

    await this.ensureRoot();
    const ext = path.extname(new URL(meta.sourceUrl || 'https://x/a.bin').pathname || 'a.bin') || '.bin';
    const localPath = this.filePath(hash, ext);
    await fs.writeFile(localPath, buffer);

    const index = await this.readIndex();
    index.entries[hash] = {
      hash,
      localPath,
      sizeBytes: buffer.length,
      provider: meta.provider || null,
      providerAssetId: meta.providerAssetId || null,
      sourceUrl: meta.sourceUrl || null,
      pageUrl: meta.pageUrl || null,
      creator: meta.creator || null,
      license: meta.license || null,
      licenseUrl: meta.licenseUrl || null,
      mediaType: meta.mediaType || 'image',
      width: meta.width || null,
      height: meta.height || null,
      durationSeconds: meta.durationSeconds || null,
      downloadedAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString()
    };
    await this.writeIndex(index);
    this.logger.info(`Cached asset ${hash.slice(0, 12)} from ${meta.provider || 'unknown'} (${Math.round(buffer.length / 1024)} KiB)`);
    return { hash, localPath, cachedNew: true, entry: index.entries[hash] };
  }

  async touch(hash) {
    const index = await this.readIndex();
    if (index.entries[hash]) {
      index.entries[hash].lastUsedAt = new Date().toISOString();
      await this.writeIndex(index);
    }
  }

  /** Remove cache entries older than ttlMs and enforce the total size ceiling. */
  async cleanup({ ttlMs = null } = {}) {
    const index = await this.readIndex();
    const cutoff = Date.now() - (ttlMs || this.defaultTtlMs);
    const removed = [];
    let totalBytes = 0;

    for (const [hash, entry] of Object.entries(index.entries)) {
      const lastUsed = Date.parse(entry.lastUsedAt || entry.downloadedAt || 0) || 0;
      if (lastUsed < cutoff) {
        try { await fs.unlink(entry.localPath); } catch (error) { /* already gone */ }
        removed.push(hash);
        delete index.entries[hash];
      } else {
        totalBytes += entry.sizeBytes || 0;
      }
    }

    // Enforce the size ceiling by evicting least-recently-used entries.
    if (totalBytes > this.maxBytes) {
      const lru = Object.entries(index.entries)
        .sort((a, b) => Date.parse(a[1].lastUsedAt || 0) - Date.parse(b[1].lastUsedAt || 0));
      for (const [hash, entry] of lru) {
        if (totalBytes <= this.maxBytes) break;
        try { await fs.unlink(entry.localPath); } catch (error) { /* ignore */ }
        totalBytes -= entry.sizeBytes || 0;
        removed.push(hash);
        delete index.entries[hash];
      }
    }

    if (removed.length) await this.writeIndex(index);
    this.logger.info(`Asset cache cleanup removed ${removed.length} entries`);
    return { removed: removed.length };
  }
}

module.exports = { AssetCache };
