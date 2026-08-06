(function sisiplusApi(global) {
  'use strict';

  const app = global.SisiPlus = global.SisiPlus || {};
  const DEFAULT_PROXY = 'https://cherry-proxy.aawersom.workers.dev';
  const DEFAULT_PROXY_KEY = '1206';
  const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 11; TV) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';

  class ApiError extends Error {
    constructor(message, details = {}) {
      super(message);
      this.name = 'SisiPlusApiError';
      Object.assign(this, details);
    }
  }

  class TTLCache {
    constructor() { this.memory = new Map(); }
    get(key) {
      const entry = this.memory.get(key);
      if (!entry || entry.expiresAt <= Date.now()) {
        if (entry) this.memory.delete(key);
        return undefined;
      }
      return entry.value;
    }
    set(key, value, ttl = 60_000) {
      this.memory.set(key, { value, expiresAt: Date.now() + ttl });
      return value;
    }
    clear() { this.memory.clear(); }
  }

  const cache = new TTLCache();

  function isAndroid() {
    try {
      return Boolean(global.Lampa && Lampa.Platform && Lampa.Platform.is('android'));
    } catch (error) { return false; }
  }

  function setting(name, fallback) {
    return app.Settings ? app.Settings.get(name, fallback) : fallback;
  }

  function proxyUrl(url, referer = '') {
    const custom = String(setting('proxy_url', '') || '').trim();
    if (custom) {
      const resolved = custom.includes('{url}')
        ? custom.replace('{url}', encodeURIComponent(url))
        : custom + encodeURIComponent(url);
      return resolved
        .replace('{referer}', encodeURIComponent(referer))
        .replace('{key}', encodeURIComponent(String(setting('proxy_key', '') || '')));
    }
    if (setting('public_proxy', true) === false) return '';
    let result = `${DEFAULT_PROXY}/proxy?url=${encodeURIComponent(url)}`;
    const key = String(setting('proxy_key', DEFAULT_PROXY_KEY) || '');
    if (key) result += `&key=${encodeURIComponent(key)}`;
    if (referer) result += `&referer=${encodeURIComponent(referer)}`;
    return result;
  }

  function nativeText(url, options = {}) {
    return new Promise((resolve, reject) => {
      if (!global.Lampa || typeof Lampa.Reguest !== 'function') {
        reject(new ApiError('Нативный транспорт Lampa недоступен', { url }));
        return;
      }
      const network = new Lampa.Reguest();
      if (typeof network.native !== 'function') {
        reject(new ApiError('Lampa.Reguest.native недоступен', { url }));
        return;
      }
      const finish = () => { if (typeof network.clear === 'function') network.clear(); };
      network.native(
        url,
        (data) => {
          finish();
          resolve(typeof data === 'string' ? data : JSON.stringify(data));
        },
        (cause) => { finish(); reject(new ApiError('Ошибка нативного запроса Lampa', { url, cause })); },
        false,
        {
          dataType: 'text',
          timeout: options.timeout || 15_000,
          headers: options.headers || {}
        }
      );
    });
  }

  async function fetchText(url, options = {}) {
    if (typeof global.fetch !== 'function') throw new ApiError('fetch недоступен', { url });
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), options.timeout || 15_000) : 0;
    try {
      const response = await global.fetch(url, {
        method: options.method || 'GET',
        headers: options.headers || {},
        body: options.body,
        credentials: options.credentials || 'omit',
        signal: controller ? controller.signal : undefined
      });
      const text = await response.text();
      if (!response.ok && options.acceptErrorBody !== true) {
        throw new ApiError(`HTTP ${response.status}`, { status: response.status, url, body: text });
      }
      return text;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Загружает страницу сайта. На Android первым используется нативный сетевой
   * транспорт Lampa (нет browser-CORS), затем обычный fetch и HTTPS-прокси.
   */
  async function siteText(url, options = {}) {
    const referer = options.referer || new URL(url).origin + '/';
    const headers = {
      'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.7',
      'User-Agent': ANDROID_UA,
      Referer: referer,
      ...(options.headers || {})
    };
    const attempts = [];
    if (options.proxy === 'always') {
      const proxied = proxyUrl(url, referer);
      if (!proxied) throw new ApiError('Прокси отключён в настройках', { url });
      return fetchText(proxied, { ...options, headers: {} });
    }
    if (isAndroid() && options.native !== false) attempts.push(() => nativeText(url, { ...options, headers }));
    attempts.push(() => fetchText(url, { ...options, headers }));
    if (options.proxy !== 'never') {
      const proxied = proxyUrl(url, referer);
      if (proxied) attempts.push(() => fetchText(proxied, { ...options, headers: {} }));
    }
    let lastError;
    const rounds = Math.max(1, Number(options.retries == null ? 2 : options.retries) + 1);
    for (let round = 0; round < rounds; round += 1) {
      for (const attempt of attempts) {
        try { return await attempt(); }
        catch (error) { lastError = error; }
      }
      if (round + 1 < rounds) await new Promise((resolve) => setTimeout(resolve, 250 * (round + 1)));
    }
    throw new ApiError('Источник не ответил ни напрямую, ни через резервный транспорт', {
      url,
      cause: lastError
    });
  }

  async function siteJson(url, options = {}) {
    const text = await siteText(url, options);
    try { return JSON.parse(text); }
    catch (cause) { throw new ApiError('Источник вернул некорректный JSON', { url, cause }); }
  }

  function mediaUrl(url, referer = '', forceProxy = false) {
    if (!url) return '';
    if (!forceProxy || isAndroid()) return url;
    return proxyUrl(url, referer) || url;
  }

  function parseDOM(html) {
    if (typeof DOMParser === 'undefined') throw new ApiError('DOMParser недоступен');
    return new DOMParser().parseFromString(String(html), 'text/html');
  }

  async function cached(key, producer, ttl = 60_000) {
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    return cache.set(key, await producer(), ttl);
  }

  app.Api = {
    ApiError,
    TTLCache,
    cache,
    isAndroid,
    proxyUrl,
    mediaUrl,
    nativeText,
    fetchText,
    siteText,
    siteJson,
    parseDOM,
    cached,
    constants: { ANDROID_UA, DEFAULT_PROXY, DEFAULT_PROXY_KEY }
  };
})(window);
