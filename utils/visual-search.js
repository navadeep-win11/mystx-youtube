/**
 * Visual Search Engine — multi-source, license-safe asset discovery.
 *
 * Provider priority (per operator configuration):
 *   1. Licensed stock footage/images  (Pexels / Pixabay / Unsplash — key-gated)
 *   2. Openly licensed assets         (Wikimedia Commons / Openverse — keyless)
 *   3. Screenshots / diagrams / user assets (upstream stages)
 *   4. AI generation                  (fallback only, upstream)
 *
 * Hard rules enforced here:
 *  - Only providers with an explicit license model are searched.
 *  - Every result carries provider, source URL, creator and license metadata.
 *  - Download URLs must be https and belong to the provider's known hosts
 *    (SSRF guard). No arbitrary web scraping of copyrighted images.
 *  - Downloaded bytes are verified (sharp for images, ffprobe for video)
 *    before they can be selected, then stored in the AssetCache.
 */

const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const sharp = require('sharp');
const { Logger } = require('./logger');
const { runFFmpeg } = require('./ffmpeg');
const { AssetCache } = require('./asset-cache');

const DOWNLOAD_TIMEOUT_MS = 20000;
const SEARCH_TIMEOUT_MS = 15000;
const PROVIDER_FAILURE_LIMIT = 2;
const PROVIDER_COOLDOWN_MS = 10 * 60 * 1000;
const USER_AGENT = 'AgentTube-Production/1.0 (local automated video pipeline; contact: operator-local)';
const MAX_DOWNLOAD_BYTES = 40 * 1024 * 1024;

/** Allowed download hosts per provider (SSRF + license-scope guard). */
const PROVIDER_DOWNLOAD_HOSTS = {
  wikimedia: ['upload.wikimedia.org', 'thumb.wikimedia.org'],
  openverse: ['api.openverse.org', 'wordpress.org', 'upload.wikimedia.org', 'live.staticflickr.com', 'images.rawpixel.com', 'i.imgur.com', 'storage.googleapis.com'],
  pexels: ['images.pexels.com', 'videos.pexels.com', 'www.pexels.com'],
  pixabay: ['cdn.pixabay.com', 'pixabay.com'],
  unsplash: ['images.unsplash.com', 'unsplash.com']
};

/** Licenses we accept, normalized. Everything else is rejected. */
const ACCEPTED_LICENSES = new Set([
  'cc0', 'pdm', 'public domain', 'cc by 1.0', 'cc by 2.0', 'cc by 2.5', 'cc by 3.0', 'cc by 4.0',
  'cc by-sa 1.0', 'cc by-sa 2.0', 'cc by-sa 2.5', 'cc by-sa 3.0', 'cc by-sa 4.0',
  'pexels license', 'pixabay license', 'pixabay content license', 'unsplash license'
]);

function licenseAccepted(license) {
  if (!license) return false;
  return ACCEPTED_LICENSES.has(String(license).toLowerCase().trim());
}

class VisualSearchEngine {
  constructor(options = {}) {
    this.logger = options.logger || new Logger('VisualSearch');
    this.cache = options.cache || new AssetCache({ logger: this.logger });
    this.providerFailures = new Map(); // provider id → consecutive failures
    this.providerCooldowns = new Map(); // provider id → cooldown-until timestamp
    this.httpClient = options.httpClient || axios.create({
      headers: { 'User-Agent': USER_AGENT },
      timeout: SEARCH_TIMEOUT_MS
    });
    this.providers = this.buildProviders(options.env || process.env);
  }

  buildProviders(env) {
    const list = [];
    if (env.PEXELS_API_KEY) list.push(new PexelsProvider(env.PEXELS_API_KEY, this.logger, this.httpClient));
    if (env.PIXABAY_API_KEY) list.push(new PixabayProvider(env.PIXABAY_API_KEY, this.logger, this.httpClient));
    if (env.UNSPLASH_ACCESS_KEY) list.push(new UnsplashProvider(env.UNSPLASH_ACCESS_KEY, this.logger, this.httpClient));
    list.push(new WikimediaProvider(this.logger, this.httpClient));
    list.push(new OpenverseProvider(this.logger, this.httpClient));
    return list;
  }

  availableProviders() {
    return this.providers.map(p => ({ id: p.id, kind: p.kind, stock: p.stock }));
  }

  /**
   * Search all willing providers for one scene query.
   * Returns ranked, license-checked candidates (not yet downloaded).
   */
  async search({ query, mediaType = 'image', orientation = 'landscape', limitPerProvider = 6, excludeAssetIds = new Set() }) {
    const results = [];
    const now = Date.now();
    const willing = this.providers.filter(p =>
      (p.kind === mediaType || mediaType === 'any') &&
      (this.providerCooldowns.get(p.id) || 0) < now
    );

    for (const provider of willing) {
      try {
        const candidates = await provider.search({ query, orientation, limit: limitPerProvider });
        this.providerFailures.set(provider.id, 0);
        for (const candidate of candidates) {
          if (!candidate || excludeAssetIds.has(candidate.providerAssetId)) continue;
          if (!licenseAccepted(candidate.license)) continue;
          if (!this.isSafeDownload(candidate)) continue;
          results.push(candidate);
        }
      } catch (error) {
        // Circuit breaker: a provider that keeps failing is skipped for a
        // cooldown window instead of stalling every scene of the production.
        const failures = (this.providerFailures.get(provider.id) || 0) + 1;
        this.providerFailures.set(provider.id, failures);
        if (failures >= PROVIDER_FAILURE_LIMIT) {
          this.providerCooldowns.set(provider.id, Date.now() + PROVIDER_COOLDOWN_MS);
          this.logger.warn(`Provider ${provider.id} failed ${failures}× consecutively — cooling down for ${PROVIDER_COOLDOWN_MS / 60000} minutes`);
        } else {
          this.logger.warn(`Provider ${provider.id} search failed: ${error.message}`);
        }
      }
    }

    return this.rank(results, { query, orientation, mediaType });
  }

  isSafeDownload(candidate) {
    try {
      const url = new URL(candidate.downloadUrl);
      if (url.protocol !== 'https:') return false;
      const hosts = PROVIDER_DOWNLOAD_HOSTS[candidate.provider];
      if (!hosts || !hosts.includes(url.hostname)) return false;
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Ranking: relevance > license permissiveness > resolution > orientation >
   * continuity (provider diversity is applied by the planner via exclusions).
   */
  rank(candidates, { query, orientation }) {
    const terms = String(query || '').toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 2);
    for (const candidate of candidates) {
      let score = 0;
      const haystack = `${candidate.title || ''} ${candidate.description || ''} ${candidate.tags || ''}`.toLowerCase();
      for (const term of terms) if (haystack.includes(term)) score += 4;
      score += candidate.providerStock ? 2 : 1; // stock providers indexed for production quality
      const minDim = Math.min(candidate.width || 0, candidate.height || 0);
      score += minDim >= 1080 ? 3 : minDim >= 720 ? 2 : minDim >= 480 ? 1 : -4;
      if (orientation === 'landscape' && (candidate.width || 0) >= (candidate.height || 0)) score += 2;
      if (orientation === 'portrait' && (candidate.height || 0) >= (candidate.width || 0)) score += 2;
      if (candidate.mediaType === 'video') score += 2; // prefer real B-roll when requested
      score += candidate.durationSeconds && candidate.durationSeconds >= 8 ? 1 : 0;
      candidate.rankScore = score;
    }
    return candidates.sort((a, b) => b.rankScore - a.rankScore);
  }

  /**
   * Download + verify + cache one candidate. Returns the enriched asset
   * record for the scene plan, or null when verification fails.
   */
  async acquire(candidate, { productionId, scenePosition }) {
    try {
      const response = await this.httpClient.get(candidate.downloadUrl, {
        responseType: 'arraybuffer',
        timeout: DOWNLOAD_TIMEOUT_MS,
        maxContentLength: MAX_DOWNLOAD_BYTES,
        headers: { 'User-Agent': 'AgentTube-Production/1.0 (licensed asset acquisition)' }
      });
      const buffer = Buffer.from(response.data);
      const mediaType = candidate.mediaType === 'video' ? 'video' : 'image';
      const verification = mediaType === 'video'
        ? await this.verifyVideo(buffer)
        : await this.verifyImage(buffer, candidate);
      if (!verification.ok) {
        this.logger.warn(`Asset ${candidate.providerAssetId} failed verification: ${verification.reason}`);
        return null;
      }

      const stored = await this.cache.put(buffer, {
        provider: candidate.provider,
        providerAssetId: candidate.providerAssetId,
        sourceUrl: candidate.downloadUrl,
        pageUrl: candidate.pageUrl || null,
        creator: candidate.creator || null,
        license: candidate.license,
        licenseUrl: candidate.licenseUrl || null,
        mediaType,
        width: verification.width || candidate.width || null,
        height: verification.height || candidate.height || null,
        durationSeconds: verification.durationSeconds || null,
        attribution: candidate.attribution || null
      });

      return {
        position: scenePosition,
        productionId,
        assetType: mediaType === 'video' ? 'stock_video' : 'stock_image',
        provider: candidate.provider,
        providerAssetId: candidate.providerAssetId,
        assetPath: stored.localPath,
        cacheHash: stored.hash,
        sourceUrl: candidate.downloadUrl,
        pageUrl: candidate.pageUrl || null,
        creator: candidate.creator || null,
        license: candidate.license,
        licenseUrl: candidate.licenseUrl || null,
        attribution: candidate.attribution || null,
        width: verification.width || candidate.width || null,
        height: verification.height || candidate.height || null,
        durationSeconds: verification.durationSeconds || null,
        rankScore: candidate.rankScore || 0,
        acquiredAt: new Date().toISOString()
      };
    } catch (error) {
      this.logger.warn(`Acquire failed for ${candidate.providerAssetId}: ${error.message}`);
      return null;
    }
  }

  async verifyImage(buffer, _candidate) {
    try {
      const metadata = await sharp(buffer).metadata();
      if (!metadata.width || !metadata.height) return { ok: false, reason: 'unreadable dimensions' };
      if (metadata.width < 480) return { ok: false, reason: 'resolution below 480px' };
      return { ok: true, width: metadata.width, height: metadata.height, format: metadata.format };
    } catch (error) {
      return { ok: false, reason: `not a valid image: ${error.message}` };
    }
  }

  async verifyVideo(buffer) {
    const tmp = path.join(this.cache.root, 'files', `verify_${Date.now()}.mp4`);
    await fs.mkdir(path.dirname(tmp), { recursive: true });
    try {
      await fs.writeFile(tmp, buffer);
      await runFFmpeg(['-v', 'error', '-i', tmp, '-t', '0.5', '-f', 'null', '-']);
      const probe = await this.probeDuration(tmp);
      if (!probe || probe < 1) return { ok: false, reason: 'video shorter than 1s' };
      return { ok: true, durationSeconds: Number(probe.toFixed(2)) };
    } catch (error) {
      return { ok: false, reason: `undecodable video: ${error.message.split('\n')[0]}` };
    } finally {
      await fs.unlink(tmp).catch(() => {});
    }
  }

  /** ffprobe duration in seconds (null when unavailable). */
  async probeDuration(mediaPath) {
    try {
      const { execFile } = require('child_process');
      const { promisify } = require('util');
      const execFileAsync = promisify(execFile);
      const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', String(mediaPath)]);
      const value = parseFloat(String(stdout).trim());
      return Number.isFinite(value) && value > 0 ? value : null;
    } catch (error) {
      return null;
    }
  }

  /**
   * End-to-end scene acquisition: try candidates in rank order until one
   * verifies and is not a duplicate (by cache hash) of an already-used asset.
   */
  async acquireBest({ query, mediaType, orientation, usedHashes, usedAssetIds, productionId, scenePosition }) {
    const candidates = await this.search({
      query,
      mediaType,
      orientation,
      excludeAssetIds: usedAssetIds || new Set()
    });
    for (const candidate of candidates.slice(0, 8)) {
      const asset = await this.acquire(candidate, { productionId, scenePosition });
      if (asset && !usedHashes.has(asset.cacheHash)) {
        usedHashes.add(asset.cacheHash);
        usedAssetIds.add(candidate.providerAssetId);
        return asset;
      }
    }
    return null;
  }
}

/* ---------------- Provider adapters ---------------- */

class BaseProvider {
  constructor(id, kind, stock, logger, httpClient) {
    this.id = id;
    this.kind = kind; // 'image' | 'video'
    this.stock = stock; // true = licensed stock provider
    this.logger = logger;
    this.httpClient = httpClient;
  }
  async search() { throw new Error('provider must implement search()'); }
}

class PexelsProvider extends BaseProvider {
  constructor(key, logger, httpClient) {
    super('pexels', 'any', true, logger, httpClient);
    this.key = key;
  }
  async search({ query, orientation, limit }) {
    const wantVideo = true; // Pexels serves both; prefer videos first
    const out = [];
    if (wantVideo) {
      const res = await this.httpClient.get('https://api.pexels.com/videos/search', {
        params: { query, per_page: limit, orientation: orientation === 'portrait' ? 'portrait' : 'landscape' },
        headers: { Authorization: this.key }, timeout: SEARCH_TIMEOUT_MS
      });
      for (const video of res.data.videos || []) {
        const files = (video.video_files || []).filter(f => f.file_type === 'video/mp4')
          .sort((a, b) => (b.height || 0) - (a.height || 0));
        const best = files.find(f => (f.height || 0) >= 720) || files[0];
        if (!best) continue;
        out.push({
          provider: 'pexels', providerAssetId: `pexels-video-${video.id}`,
          mediaType: 'video', title: video.user?.name || query,
          downloadUrl: best.link, pageUrl: video.url || null,
          creator: video.user?.name || null, license: 'Pexels License',
          licenseUrl: 'https://www.pexels.com/license/',
          width: best.width, height: best.height,
          durationSeconds: video.duration || null, providerStock: true
        });
      }
    }
    const imgRes = await this.httpClient.get('https://api.pexels.com/v1/search', {
      params: { query, per_page: limit, orientation: orientation === 'portrait' ? 'portrait' : 'landscape' },
      headers: { Authorization: this.key }, timeout: SEARCH_TIMEOUT_MS
    });
    for (const photo of imgRes.data.photos || []) {
      out.push({
        provider: 'pexels', providerAssetId: `pexels-photo-${photo.id}`,
        mediaType: 'image', title: photo.alt || query,
        downloadUrl: photo.src?.original, pageUrl: photo.url || null,
        creator: photo.photographer || null, license: 'Pexels License',
        licenseUrl: 'https://www.pexels.com/license/',
        width: photo.width, height: photo.height, providerStock: true
      });
    }
    return out;
  }
}

class PixabayProvider extends BaseProvider {
  constructor(key, logger, httpClient) {
    super('pixabay', 'any', true, logger, httpClient);
    this.key = key;
  }
  async search({ query, orientation, limit }) {
    const out = [];
    const params = { key: this.key, q: query, per_page: Math.min(limit, 24), safesearch: 'true' };
    if (orientation !== 'portrait') params.orientation = 'horizontal';
    try {
      const vRes = await this.httpClient.get('https://pixabay.com/api/videos/', { params, timeout: SEARCH_TIMEOUT_MS });
      for (const video of vRes.data.hits || []) {
        const sizes = ['large', 'medium', 'small', 'tiny'];
        for (const size of sizes) {
          if (video.videos?.[size]?.url) {
            out.push({
              provider: 'pixabay', providerAssetId: `pixabay-video-${video.id}`,
              mediaType: 'video', title: query, downloadUrl: video.videos[size].url,
              pageUrl: video.pageURL || null, creator: video.user || null,
              license: 'Pixabay Content License', licenseUrl: 'https://pixabay.com/service/license-summary/',
              width: video.videos[size].width, height: video.videos[size].height,
              durationSeconds: video.duration || null, providerStock: true
            });
            break;
          }
        }
      }
    } catch (error) { /* video API can fail independently */ }
    const iRes = await this.httpClient.get('https://pixabay.com/api/', { params, timeout: SEARCH_TIMEOUT_MS });
    for (const photo of iRes.data.hits || []) {
      out.push({
        provider: 'pixabay', providerAssetId: `pixabay-photo-${photo.id}`,
        mediaType: 'image', title: photo.tags || query,
        downloadUrl: photo.largeImageURL || photo.webformatURL, pageUrl: photo.pageURL || null,
        creator: photo.user || null, license: 'Pixabay Content License',
        licenseUrl: 'https://pixabay.com/service/license-summary/',
        width: photo.imageWidth, height: photo.imageHeight, providerStock: true
      });
    }
    return out;
  }
}

class UnsplashProvider extends BaseProvider {
  constructor(key, logger, httpClient) {
    super('unsplash', 'image', true, logger, httpClient);
    this.key = key;
  }
  async search({ query, orientation, limit }) {
    const res = await this.httpClient.get('https://api.unsplash.com/search/photos', {
      params: { query, per_page: limit, orientation: orientation === 'portrait' ? 'portrait' : 'landscape' },
      headers: { Authorization: `Client-ID ${this.key}` }, timeout: SEARCH_TIMEOUT_MS
    });
    return (res.data.results || []).map(photo => ({
      provider: 'unsplash', providerAssetId: `unsplash-${photo.id}`,
      mediaType: 'image', title: photo.alt_description || query,
      downloadUrl: photo.urls?.raw || photo.urls?.full, pageUrl: photo.links?.html || null,
      creator: photo.user?.name || null, license: 'Unsplash License',
      licenseUrl: 'https://unsplash.com/license',
      width: photo.width, height: photo.height,
      attribution: `Photo by ${photo.user?.name || 'unknown'} on Unsplash`, providerStock: true
    }));
  }
}

class WikimediaProvider extends BaseProvider {
  constructor(logger, httpClient) {
    super('wikimedia', 'image', false, logger, httpClient);
  }
  async search({ query, limit }) {
    const run = (searchTerms) => this.httpClient.get('https://commons.wikimedia.org/w/api.php', {
      params: {
        action: 'query', format: 'json', generator: 'search',
        gsrsearch: `filetype:bitmap ${searchTerms}`, gsrnamespace: 6, gsrlimit: limit,
        prop: 'imageinfo', iiprop: 'url|extmetadata|size', iiurlwidth: 1920, origin: '*'
      },
      timeout: SEARCH_TIMEOUT_MS
    });

    const terms = String(query || '').split(/\s+/).filter(Boolean);
    let res = await run(terms.join(' '));
    let pages = res.data?.query?.pages || {};
    if (!Object.keys(pages).length && terms.length > 2) {
      // AND-semantics search: relax to the two most significant terms.
      res = await run(terms.slice(0, 2).join(' '));
      pages = res.data?.query?.pages || {};
    }
    const out = [];
    for (const page of Object.values(pages)) {
      const info = page.imageinfo?.[0];
      if (!info) continue;
      const meta = info.extmetadata || {};
      const license = String(meta.LicenseShortName?.value || '').trim();
      out.push({
        provider: 'wikimedia', providerAssetId: `wikimedia-${page.pageid}`,
        mediaType: 'image', title: page.title || query,
        downloadUrl: info.thumburl || info.url, pageUrl: info.descriptionurl || null,
        creator: (meta.Artist?.value || '').replace(/<[^>]+>/g, '').trim() || null,
        license: license || null,
        licenseUrl: meta.LicenseUrl?.value || null,
        width: info.thumbwidth || info.width, height: info.thumbheight || info.height,
        attribution: license ? `${page.title} — ${license}, via Wikimedia Commons` : null,
        providerStock: false
      });
    }
    return out;
  }
}

class OpenverseProvider extends BaseProvider {
  constructor(logger, httpClient) {
    super('openverse', 'image', false, logger, httpClient);
  }
  async search({ query, limit, orientation }) {
    const res = await this.httpClient.get('https://api.openverse.org/v1/images/', {
      params: { q: query, page_size: limit, license: 'cc0,pdm,by,by-sa', aspect_ratio: orientation === 'portrait' ? 'tall' : 'wide' },
      timeout: SEARCH_TIMEOUT_MS
    });
    return (res.data.results || []).map(item => ({
      provider: 'openverse', providerAssetId: `openverse-${item.id}`,
      mediaType: 'image', title: item.title || query,
      downloadUrl: item.url, pageUrl: item.foreign_landing_url || null,
      creator: item.creator || null,
      license: `${item.license.toUpperCase()} ${item.license_version || ''}`.trim(),
      licenseUrl: item.license_url || null,
      width: item.width, height: item.height,
      attribution: item.attribution || null, providerStock: false
    }));
  }
}

module.exports = { VisualSearchEngine, licenseAccepted, PROVIDER_DOWNLOAD_HOSTS, ACCEPTED_LICENSES };
