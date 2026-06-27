// ============================================
// Puchuku Backend Server (Cross-platform + SSL + Subtitles)
// Playwright WebKit edition — lighter than Chromium
// ============================================
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { webkit } from 'playwright';
import { existsSync } from 'fs';
import { Readable } from 'stream';
import os from 'os';
import readline from 'readline';
import { Agent, setGlobalDispatcher } from 'undici';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;
const DEBUG = process.env.DEBUG !== 'false';

const IS_WINDOWS = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

setGlobalDispatcher(
  new Agent({
    connections: 64,
    pipelining: 1,
    keepAliveTimeout: 30_000,
    keepAliveMaxTimeout: 60_000,
  })
);

const log = {
  _fmt: (lvl, scope, msg, extra) => {
    const ts = new Date().toISOString();
    const base = `${ts} [${lvl}] [${scope}] ${msg}`;
    return extra !== undefined ? `${base} ${JSON.stringify(extra)}` : base;
  },
  info:  (s, m, e) => console.log(log._fmt('INFO', s, m, e)),
  warn:  (s, m, e) => console.warn(log._fmt('WARN', s, m, e)),
  error: (s, m, e) => console.error(log._fmt('ERROR', s, m, e)),
  debug: (s, m, e) => { if (DEBUG) console.log(log._fmt('DEBUG', s, m, e)); },
};

app.set('trust proxy', true);

const isProduction = process.env.NODE_ENV === 'production';
const distPath = join(__dirname, '..', 'dist');

app.use((req, res, next) => {
  const start = Date.now();
  log.debug('HTTP', `→ ${req.method} ${req.originalUrl}`, { ip: req.ip });
  res.on('finish', () => {
    log.debug('HTTP', `← ${req.method} ${req.path} ${res.statusCode}`, { ms: Date.now() - start });
  });
  next();
});

app.use(cors());
app.use(express.json());

if (isProduction && existsSync(distPath)) {
  app.use(express.static(distPath));
}

const getBaseUrl = (req) => {
  const proto = isProduction
    ? 'https'
    : (req.headers['x-forwarded-proto'] || req.protocol);
  return `${proto}://${req.get('host')}`;
};

// ============================================
// SHARED BROWSER MANAGER (Playwright WebKit)
// ============================================
let browserInstance = null;

async function getBrowser() {
  if (browserInstance) {
    // Playwright doesn't expose .connected, so we probe with a lightweight call
    try {
      browserInstance.contexts(); // throws if browser is dead
      return browserInstance;
    } catch {
      log.warn('Browser', 'WebKit instance dead, relaunching');
      browserInstance = null;
    }
  }

  log.info('Browser', 'Launching shared WebKit instance');
  browserInstance = await webkit.launch({
    headless: true,
    // WebKit doesn't need --no-sandbox style flags
  });

  log.info('Browser', 'WebKit ready');
  return browserInstance;
}

// ============================================
// IN-MEMORY STREAM CACHE (TTL)
// ============================================
const streamCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

function cacheGet(key) {
  const hit = streamCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.t > CACHE_TTL_MS) { streamCache.delete(key); return null; }
  return hit.data;
}
function cacheSet(key, data) {
  streamCache.set(key, { t: Date.now(), data });
}

// ============================================
// PROXY HELPERS
// ============================================
const UNWRAP_NESTED = process.env.UNWRAP_NESTED_PROXY !== 'false';
function unwrapProxy(u) {
  if (!UNWRAP_NESTED) return u;
  try {
    const parsed = new URL(u);
    if (parsed.hostname === 'storm.vodvidl.site' && parsed.pathname === '/proxy') {
      const inner = parsed.searchParams.get('url');
      if (inner) return decodeURIComponent(inner);
    }
  } catch { /* ignore */ }
  return u;
}

const UPSTREAM_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Referer': 'https://vidlink.pro/',
  'Origin': 'https://vidlink.pro',
};

function looksLikeSrt(text) {
  return !/^\uFEFF?WEBVTT/.test(text) && /\d{2}:\d{2}:\d{2},\d{3}\s*-->/.test(text);
}
function srtToVtt(srt) {
  const body = srt
    .replace(/\r+/g, '')
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  return `WEBVTT\n\n${body}`;
}

// ============================================
// 1. HLS / SUBTITLE PROXY
// ============================================
app.get('/api/proxy', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('URL is required');

  let decodedUrl;
  try {
    decodedUrl = decodeURIComponent(targetUrl);
  } catch {
    return res.status(400).send('Invalid URL encoding');
  }

  decodedUrl = unwrapProxy(decodedUrl);
  res.setHeader('Access-Control-Allow-Origin', '*');

  const lower = decodedUrl.split('?')[0].toLowerCase();
  const isPlaylist = lower.endsWith('.m3u8');
  const isSubtitle = lower.endsWith('.vtt') || lower.endsWith('.srt');

  log.debug('Proxy', `Fetching ${isPlaylist ? 'playlist' : isSubtitle ? 'subtitle' : 'segment'}`, { url: decodedUrl });

  try {
    const baseUrl = getBaseUrl(req);
    const upstream = await fetch(decodedUrl, { headers: UPSTREAM_HEADERS });

    if (!upstream.ok) {
      log.warn('Proxy', 'Upstream non-OK', { status: upstream.status, url: decodedUrl });
      return res.status(upstream.status).send(upstream.statusText);
    }

    const contentType = upstream.headers.get('content-type') || '';
    const isM3U8 = isPlaylist || contentType.includes('mpegurl');

    if (isSubtitle || contentType.includes('text/vtt') || contentType.includes('subrip')) {
      let text = await upstream.text();
      if (looksLikeSrt(text)) text = srtToVtt(text);
      else if (!/^\uFEFF?WEBVTT/.test(text)) text = `WEBVTT\n\n${text}`;
      res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.send(text);
    }

    if (isM3U8) {
      const text = await upstream.text();
      const rewritten = text
        .split('\n')
        .map((raw) => {
          const line = raw.trim();
          if (line.startsWith('#') && line.includes('URI="')) {
            return line.replace(/URI="([^"]+)"/g, (_, uri) => {
              let abs = uri;
              if (!/^https?:\/\//i.test(uri)) {
                try { abs = new URL(uri, decodedUrl).href; } catch { return `URI="${uri}"`; }
              }
              abs = unwrapProxy(abs);
              return `URI="${baseUrl}/api/proxy?url=${encodeURIComponent(abs)}"`;
            });
          }
          if (line && !line.startsWith('#')) {
            let absoluteUrl = line;
            if (!/^https?:\/\//i.test(line)) {
              try { absoluteUrl = new URL(line, decodedUrl).href; } catch { return line; }
            }
            absoluteUrl = unwrapProxy(absoluteUrl);
            return `${baseUrl}/api/proxy?url=${encodeURIComponent(absoluteUrl)}`;
          }
          return line;
        })
        .join('\n');

      res.setHeader('Content-Type', contentType || 'application/vnd.apple.mpegurl');
      return res.send(rewritten);
    }

    if (contentType) res.setHeader('Content-Type', contentType);
    const len = upstream.headers.get('content-length');
    if (len) res.setHeader('Content-Length', len);
    res.setHeader('Cache-Control', 'public, max-age=86400');

    if (upstream.body) {
      Readable.fromWeb(upstream.body).pipe(res);
    } else {
      res.send(Buffer.from(await upstream.arrayBuffer()));
    }
  } catch (error) {
    log.error('Proxy', 'Proxy failed', { msg: error.message, url: decodedUrl });
    if (!res.headersSent) res.status(500).send('Proxy error');
  }
});

// ============================================
// 2. STREAM & SUBTITLE EXTRACTION (WebKit)
// ============================================
app.get('/api/stream', async (req, res) => {
  const { type, id, season, episode } = req.query;
  if (!type || !id) return res.status(400).json({ error: 'type and id are required' });

  const cacheKey = `${type}:${id}:${season || 1}:${episode || 1}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    log.debug('Stream', 'Cache HIT', { cacheKey });
    return res.json({
      ...cached,
      proxiedUrl: `${getBaseUrl(req)}/api/proxy?url=${encodeURIComponent(cached.streamUrl)}`,
      cached: true,
    });
  }

  const vidlinkUrl =
    type === 'movie'
      ? `https://vidlink.pro/movie/${id}`
      : `https://vidlink.pro/tv/${id}/${season || 1}/${episode || 1}`;

  const baseUrl = getBaseUrl(req);
  const t0 = Date.now();
  let context = null;
  let page = null;

  try {
    const browser = await getBrowser();

    // Each request gets its own isolated context (like incognito)
    // This is the Playwright equivalent of newPage() but properly isolated
    context = await browser.newContext({
      userAgent: UPSTREAM_HEADERS['User-Agent'],
      extraHTTPHeaders: {
        'Referer': UPSTREAM_HEADERS['Referer'],
        'Origin': UPSTREAM_HEADERS['Origin'],
      },
    });

    page = await context.newPage();

    // Block heavy resources to save RAM
    await page.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (['image', 'stylesheet', 'font', 'media'].includes(type)) {
        route.abort();
      } else {
        route.continue();
      }
    });

    log.info('Stream', 'Scraping start', { vidlinkUrl });

    const extractionPromise = new Promise((resolve) => {
      const timer = setTimeout(() => {
        log.warn('Stream', 'Extraction timed out (15s)', { cacheKey });
        resolve(null);
      }, 15000);

      // Playwright: intercept responses
      page.on('response', async (response) => {
        const url = response.url();
        if (url.includes('/api/b/movie/') || url.includes('/api/b/tv/')) {
          try {
            const json = await response.json();
            if (json?.stream?.playlist) {
              clearTimeout(timer);
              log.debug('Stream', 'Playlist found', {
                captions: (json.stream.captions || []).length,
              });
              resolve({
                playlist: json.stream.playlist,
                captions: json.stream.captions || [],
              });
            }
          } catch (e) {
            log.debug('Stream', 'Response parse skipped', { msg: e.message });
          }
        }
      });
    });

    // Don't await navigation — let the response listener fire
    page.goto(vidlinkUrl, { waitUntil: 'commit' }).catch((e) =>
      log.debug('Stream', 'Navigation note', { msg: e.message })
    );

    const result = await extractionPromise;

    if (result) {
      const payload = { streamUrl: result.playlist, subtitles: result.captions };
      cacheSet(cacheKey, payload);
      log.info('Stream', 'Scrape success', { cacheKey, ms: Date.now() - t0 });
      return res.json({
        ...payload,
        proxiedUrl: `${baseUrl}/api/proxy?url=${encodeURIComponent(result.playlist)}`,
        cached: false,
      });
    }

    log.warn('Stream', 'No stream found', { cacheKey, ms: Date.now() - t0 });
    res.status(404).json({ error: 'No stream found' });
  } catch (error) {
    log.error('Stream', 'Scraping failed', { msg: error.message, cacheKey });
    if (!res.headersSent) res.status(500).json({ error: 'Scraping failed' });
  } finally {
    // Always clean up the context — this frees memory immediately
    if (context) {
      await context.close().catch((e) =>
        log.debug('Stream', 'Context close note', { msg: e.message })
      );
    }
  }
});

// ============================================
// HEALTH CHECK
// ============================================
app.get('/api/health', async (req, res) => {
  const browserUp = !!browserInstance;
  res.json({
    status: 'ok',
    platform: process.platform,
    browser: browserUp,
    browserType: 'webkit',
    cacheSize: streamCache.size,
    uptime: process.uptime(),
  });
});

if (isProduction) {
  app.get('*', (req, res) => {
    res.sendFile(join(distPath, 'index.html'));
  });
}

const server = app.listen(PORT, '0.0.0.0', () => {
  log.info('Server', '🚀 Puchuku Backend running', {
    port: PORT,
    production: isProduction,
    platform: process.platform,
    browser: 'playwright-webkit',
  });
});

// ============================================
// GRACEFUL SHUTDOWN
// ============================================
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info('Server', `Received ${signal}, shutting down`);
  server.close();
  try {
    if (browserInstance) {
      await browserInstance.close();
      log.info('Browser', 'WebKit closed cleanly');
    }
  } catch (e) {
    log.error('Browser', 'Error during shutdown', { msg: e.message });
  } finally {
    process.exit(0);
  }
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
if (IS_WINDOWS) {
  process.on('SIGBREAK', () => shutdown('SIGBREAK'));
  readline
    .createInterface({ input: process.stdin, output: process.stdout })
    .on('SIGINT', () => process.emit('SIGINT'));
}

process.on('unhandledRejection', (reason) =>
  log.error('Process', 'Unhandled rejection', { reason: String(reason) })
);