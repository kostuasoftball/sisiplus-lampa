const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function makeContext(extra = {}) {
  const context = {
    console,
    URL,
    Response,
    AbortController,
    setTimeout,
    clearTimeout,
    ...extra
  };
  context.window = context;
  return vm.createContext(context);
}

function load(context, relativePath) {
  const filename = path.join(root, relativePath);
  vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
}

test('all browser modules have valid JavaScript syntax', () => {
  const files = [
    'loader.js', 'api.js', 'adapter-utils.js', 'player.js', 'ui.js', 'settings.js', 'core.js',
    'adapters/live-base.js', 'adapters/pornhub.js', 'adapters/xvideos.js',
    'adapters/xhamster.js', 'adapters/efukt.js', 'adapters/bongacams.js',
    'adapters/runetki.js', 'adapters/chaturbate.js', 'adapters/stripchat.js'
  ];
  files.forEach((file) => {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotThrow(() => new vm.Script(source, { filename: file }));
  });
});

test('all eight requested source adapters register independently', () => {
  const context = makeContext();
  load(context, 'api.js');
  load(context, 'adapter-utils.js');
  load(context, 'settings.js');
  load(context, 'core.js');
  [
    'adapters/live-base.js', 'adapters/pornhub.js', 'adapters/xvideos.js',
    'adapters/xhamster.js', 'adapters/efukt.js', 'adapters/bongacams.js',
    'adapters/runetki.js', 'adapters/chaturbate.js', 'adapters/stripchat.js'
  ].forEach((file) => load(context, file));
  assert.deepEqual(
    Array.from(context.SisiPlus.getAdapters(), (adapter) => adapter.id).sort(),
    ['bongacams', 'chaturbate', 'efukt', 'pornhub', 'runetki', 'stripchat', 'xhamster', 'xvideos']
  );
  ['bongacams', 'runetki', 'chaturbate', 'stripchat'].forEach((id) => {
    const filters = context.SisiPlus.getAdapter(id).getFilters();
    assert.equal(typeof filters.then, 'function');
  });
});

test('settings are compatible with Lampa input rendering and contain no age gate', () => {
  const params = [];
  const context = makeContext({
    Lampa: {
      Storage: { field: () => undefined, get: (name, fallback) => fallback },
      SettingsApi: {
        addComponent() {},
        addParam(entry) { params.push(entry.param); }
      }
    }
  });
  load(context, 'settings.js');
  context.SisiPlus.Settings.init();

  assert.equal(params.some((param) => param.name === 'sisiplus_age_confirmed'), false);
  params.filter((param) => param.type === 'input').forEach((param) => {
    assert.equal(typeof param.values, 'string');
  });
});

test('adapter manifest contains unique enabled module records', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'adapters/manifest.json'), 'utf8'));
  assert.ok(Array.isArray(manifest.adapters));
  const ids = manifest.adapters.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length);
  manifest.adapters.forEach((entry) => {
    assert.equal(typeof entry.module, 'string');
    assert.ok(entry.module.startsWith('adapters/'));
  });
});

test('Stripchat adapter maps API cards and stream qualities to the common contract', async () => {
  const model = {
    id: 42,
    username: 'contract_demo',
    snapshotUrl: 'https://images.example/42.jpg',
    previewUrl: 'https://images.example/42-preview.mp4',
    status: 'public',
    viewersCount: 100,
    stream: {
      url: 'https://cdn.example/42.m3u8',
      urls: { '480p': 'https://cdn.example/42.m3u8' }
    }
  };
  const context = makeContext({
    fetch: async () => new Response(JSON.stringify({ models: [model], total: 1 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  });
  load(context, 'api.js');
  load(context, 'adapter-utils.js');
  load(context, 'settings.js');
  load(context, 'core.js');
  load(context, 'adapters/stripchat.js');

  const adapter = context.SisiPlus.getAdapter('stripchat');
  const result = await adapter.getList('popular', 1);
  const video = await adapter.getVideo(result.items[0].id, result.items[0]);
  assert.equal(result.items[0].title, 'contract_demo');
  assert.equal(result.items[0].preview, model.previewUrl);
  assert.equal(video.streams['480p'], model.stream.url);
  assert.match(video.webpageUrl, /contract_demo$/);
});

test('Chaturbate omits hidden rooms and parses its unicode-escaped room dossier', async () => {
  const streamUrl = 'https://edge.example/public-room.m3u8';
  const encodedDossier = JSON.stringify({ hls_source: streamUrl }).replaceAll('"', '\\u0022');
  const context = makeContext({
    fetch: async (url) => String(url).includes('/api/public/affiliates/onlinerooms/')
      ? new Response(JSON.stringify({ results: [
        { username: 'hidden_room', current_show: 'hidden' },
        { username: 'public_room', current_show: 'public' }
      ] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      : new Response(`window.initialRoomDossier = "${encodedDossier}";`, {
        status: 200,
        headers: { 'Content-Type': 'text/html' }
      })
  });
  load(context, 'api.js');
  load(context, 'adapter-utils.js');
  load(context, 'settings.js');
  load(context, 'core.js');
  load(context, 'adapters/live-base.js');
  load(context, 'adapters/chaturbate.js');

  const adapter = context.SisiPlus.getAdapter('chaturbate');
  const listing = await adapter.getList('all', 1, {});
  assert.deepEqual(Array.from(listing.items, (item) => item.id), ['public_room']);
  const video = await adapter.getVideo(listing.items[0].id, listing.items[0]);
  assert.equal(video.streams.HLS, streamUrl);
});

test('player respects the quality selected in Lampa', () => {
  const context = makeContext({
    Lampa: { Storage: { field: () => '720', get: () => '' } }
  });
  load(context, 'player.js');
  const selected = context.SisiPlus.Player.chooseDefault({
    '480p': 'https://cdn.example/480.m3u8',
    '720p': 'https://cdn.example/720.m3u8',
    original: 'https://cdn.example/original.m3u8'
  });
  assert.equal(selected, 'https://cdn.example/720.m3u8');
});

test('loader propagates its version to every browser module', async () => {
  const scripts = [];
  let booted = false;
  const context = makeContext({
    location: { href: 'https://plugins.example/SisiPlus/' },
    SisiPlus: { boot() { booted = true; } },
    fetch: async () => ({ ok: true, json: async () => ({ adapters: [] }) })
  });
  context.document = {
    currentScript: { src: 'https://plugins.example/SisiPlus/loader.js?v=test-build', dataset: {} },
    scripts,
    createElement: () => ({ dataset: {} }),
    head: {
      appendChild(node) {
        scripts.push(node);
        setTimeout(() => node.onload(), 0);
      }
    },
    documentElement: { appendChild() {} }
  };
  load(context, 'loader.js');
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(booted, true);
  assert.ok(scripts.length >= 5);
  scripts.forEach((script) => assert.match(script.src, /[?&]v=test-build/));
});
