(function sisiplusPlayer(global) {
  'use strict';
  const app = global.SisiPlus = global.SisiPlus || {};
  const contexts = new Map();
  let contextSequence = 0;

  function notify(message) {
    if (global.Lampa && Lampa.Noty) Lampa.Noty.show(message);
    else console.warn('[SisiPlus]', message);
  }

  function openWebPage(url) {
    if (!url) return false;
    try { if (global.Lampa && Lampa.WebView && Lampa.WebView.open) { Lampa.WebView.open(url); return true; } } catch (error) {}
    try { if (global.Lampa && Lampa.Browser && Lampa.Browser.open) { Lampa.Browser.open(url); return true; } } catch (error) {}
    try { if (global.AndroidJS && global.AndroidJS.openUrl) { global.AndroidJS.openUrl(url); return true; } } catch (error) {}
    try { if (global.Android && global.Android.openUrl) { global.Android.openUrl(url); return true; } } catch (error) {}
    try { return Boolean(global.open(url, '_blank')); } catch (error) {}
    return false;
  }

  function chooseDefault(streams) {
    let preferred = '';
    try {
      preferred = Lampa.Storage.field('video_quality_default') || Lampa.Storage.get('video_quality_default', '');
    } catch (error) {}
    if (preferred) {
      const wanted = String(preferred).replace(/p$/i, '');
      const key = Object.keys(streams).find((quality) => quality.replace(/p$/i, '') === wanted);
      if (key) return streams[key];
    }
    const priorities = ['original', 'HLS', '1080p', '720p', '480p', '360p', '240p', 'High', 'Low'];
    for (const key of priorities) if (streams[key]) return streams[key];
    return Object.keys(streams).map((key) => streams[key]).find(Boolean);
  }

  function videoEntry(video, fallback = {}) {
    const streams = video && video.streams ? video.streams : {};
    return {
      title: video.title || fallback.title || 'SisiPlus',
      url: chooseDefault(streams),
      quality: { ...streams },
      poster: video.poster || fallback.poster || '',
      headers: video.headers || undefined,
      // Не даём глобальной настройке внешнего проигрывателя увести пользователя
      // из плейлиста: кнопки «предыдущее/следующее» есть только во внутреннем.
      launch_player: 'inner'
    };
  }

  function play(video, options = {}) {
    const entry = videoEntry(video, options.fallback || {});
    if (!entry.url || !global.Lampa || !Lampa.Player) {
      notify('Прямой поток недоступен для внутреннего плеера. Страницу сайта можно открыть долгим нажатием на карточку.');
      return false;
    }
    const playlist = options.playlist && options.playlist.length ? options.playlist : [entry];
    try {
      Lampa.Player.play(entry);
      Lampa.Player.playlist(playlist);
      return true;
    } catch (error) {
      console.error('[SisiPlus:player]', error);
      notify('Плеер Lampa не смог открыть поток');
      return false;
    }
  }

  /**
   * Запоминает исходные элементы одной видимой сетки. Карточки хранят только
   * короткий context id, поэтому любой независимый адаптер автоматически
   * получает плейлист и кнопки «предыдущее/следующее» без специальных условий.
   */
  function rememberItems(adapterId, items) {
    const id = `${adapterId}:${Date.now()}:${++contextSequence}`;
    contexts.set(id, {
      adapterId,
      items: (items || []).filter((item) => item && item.id && !item.sisiplusAction).slice()
    });
    // Экранов одновременно открыто немного, но ограничение защищает долгую сессию ТВ.
    if (contexts.size > 40) contexts.delete(contexts.keys().next().value);
    return id;
  }

  async function resolvePlayable(adapter, items, start, attempts) {
    const count = Math.min(items.length, Math.max(1, attempts || 1));
    let lastError;
    for (let step = 0; step < count; step += 1) {
      const index = (start + step) % items.length;
      const item = items[index];
      if (!item || item.offline) continue;
      try {
        const video = await adapter.getVideo(item.id, item);
        if (chooseDefault((video && video.streams) || {})) return { video, item, index };
      } catch (error) { lastError = error; }
    }
    throw lastError || new Error('Доступный поток не найден');
  }

  function lazyEntry(adapter, items, index) {
    const source = items[index];
    const entry = {
      title: source.title || source.name || adapter.getName(),
      poster: source.poster || '',
      launch_player: 'inner'
    };
    entry.url = function resolveUrl(ready) {
      resolvePlayable(adapter, items, index, Math.min(items.length, 8)).then(({ video, item }) => {
        Object.assign(entry, videoEntry(video, item));
        ready();
      }).catch((error) => {
        console.warn(`[SisiPlus:${adapter.id}:playlist]`, source.id, error);
        notify('Следующий доступный поток не найден');
        // Lampa блокирует дальнейшие переключения, пока callback lazy-url не вызван.
        // Оставляем текущий поток URL-ом этой позиции и снимаем блокировку.
        const current = Lampa.PlayerVideo && Lampa.PlayerVideo.video ? Lampa.PlayerVideo.video() : null;
        entry.url = current && current.currentSrc ? current.currentSrc : 'about:blank';
        ready();
      });
    };
    return entry;
  }

  async function playItem(item, adapter) {
    if (!adapter) return false;
    if (app.UI && app.UI.Preview) app.UI.Preview.hide();
    if (global.Lampa && Lampa.Loading) Lampa.Loading.start();
    try {
      const context = contexts.get(item.playbackContextId);
      const items = context && context.adapterId === adapter.id && context.items.length
        ? context.items
        : [item];
      const requestedIndex = Math.max(0, items.findIndex((entry) => String(entry.id) === String(item.id)));
      const first = await resolvePlayable(adapter, items, requestedIndex, Math.min(items.length, 8));
      const playlist = items.map((entry, index) => lazyEntry(adapter, items, index));
      Object.assign(playlist[first.index], videoEntry(first.video, first.item));
      return play(first.video, { playlist, fallback: first.item });
    } catch (error) {
      console.error(`[SisiPlus:${adapter.id}:video]`, error);
      notify(error.message || 'Не удалось получить видео');
      return false;
    } finally {
      if (global.Lampa && Lampa.Loading) Lampa.Loading.stop();
    }
  }

  app.Player = { play, playItem, openWebPage, chooseDefault, rememberItems, resolvePlayable };
})(window);
