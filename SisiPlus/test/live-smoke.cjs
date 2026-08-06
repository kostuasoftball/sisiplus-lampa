const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const context = vm.createContext({
  console, URL, Response, AbortController, fetch, setTimeout, clearTimeout
});
context.window = context;

function load(file) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
}

load('api.js');
load('adapter-utils.js');
context.SisiPlus.Settings = {
  get(name, fallback) { return name === 'public_proxy' ? true : fallback; },
  registerAdapter() {},
  isAdapterEnabled() { return true; }
};
load('core.js');
[
  'adapters/live-base.js', 'adapters/pornhub.js', 'adapters/xvideos.js',
  'adapters/xhamster.js', 'adapters/efukt.js', 'adapters/bongacams.js',
  'adapters/runetki.js', 'adapters/chaturbate.js', 'adapters/stripchat.js'
].forEach(load);

async function probe(url, referer) {
  if (!url) return { ok: false, status: 0 };
  const response = await fetch(url, {
    headers: { Range: 'bytes=0-2047', Referer: referer || '' },
    signal: AbortSignal.timeout(20_000)
  });
  if (response.body) await response.body.cancel();
  return { ok: response.ok, status: response.status, type: response.headers.get('content-type') || '' };
}

function curlLiveListing(adapter) {
  const url = `${adapter.config.host}/tools/listing_v3.php?livetab=all&offset=0&limit=3`;
  const body = execFileSync('curl', [
    '-L', '-sS', '--max-time', '20',
    '-A', 'Mozilla/5.0 (Linux; Android 11; TV) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    '-e', `${adapter.config.host}/`, '-H', 'X-Requested-With: XMLHttpRequest', url
  ], { encoding: 'utf8' });
  return JSON.parse(body).models || [];
}

(async () => {
  let failed = false;
  for (const adapter of context.SisiPlus.getAdapters()) {
    try {
      const categories = await adapter.getCategories();
      const listing = await adapter.getList(categories[0].id, 1, {});
      if (!listing.items.length) throw new Error('пустой каталог');
      const video = await adapter.getVideo(listing.items[0].id, listing.items[0]);
      const stream = Object.values(video.streams || {}).find(Boolean);
      const check = stream ? await probe(stream, video.webpageUrl) : { ok: false, status: 0, type: 'WebView fallback' };
      console.log(`${adapter.id}: cards=${listing.items.length}, stream=${stream ? check.status : 'fallback'}, ${check.type}`);
      if (stream && !check.ok) throw new Error(`поток HTTP ${check.status}`);
    } catch (error) {
      if (adapter.id === 'bongacams' || adapter.id === 'runetki') {
        try {
          const models = curlLiveListing(adapter);
          const item = adapter.mapModel(models[0]);
          const video = await adapter.getVideo(item.id, item);
          const stream = Object.values(video.streams).find(Boolean);
          const check = await probe(stream, video.webpageUrl);
          console.log(`${adapter.id}: cards=${models.length}, stream=${check.status}, ${check.type} (Android-native route)`);
          if (!check.ok) throw new Error(`поток HTTP ${check.status}`);
          continue;
        } catch (nativeError) { error = nativeError; }
      }
      failed = true;
      console.error(`${adapter.id}: FAIL — ${error.message}`);
    }
  }
  process.exitCode = failed ? 1 : 0;
})();
