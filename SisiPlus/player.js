(function sisiplusPlayer(global) {
  'use strict';
  const app = global.SisiPlus = global.SisiPlus || {};
  const contexts = new Map();
  let contextSequence = 0;
  let activeInternal = false;

  function notify(message) {
    if (global.Lampa && Lampa.Noty) Lampa.Noty.show(message);
    else console.warn('[SisiPlus]', message);
  }

  function mode(override) {
    if (override === 'inner' || override === 'external') return override;
    const value = app.Settings ? app.Settings.get('player_mode', 'external') : 'external';
    return value === 'inner' ? 'inner' : 'external';
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

  function videoEntry(video, fallback = {}, playerMode = 'external') {
    const streams = video && video.streams ? video.streams : {};
    const entry = {
      title: video.title || fallback.title || 'SisiPlus',
      url: chooseDefault(streams),
      quality: { ...streams },
      poster: video.poster || fallback.poster || '',
      headers: video.headers || undefined
    };
    // В external режиме поле не задаётся: Lampa использует выбранный самим
    // пользователем системный плеер. Только явный inner принудительно включает Lampa.
    if (playerMode === 'inner') {
      entry.launch_player = 'inner';
      entry.sisiplusInternal = true;
    }
    return entry;
  }

  function play(video, options = {}) {
    const playerMode = mode(options.mode);
    const entry = options.entry || videoEntry(video, options.fallback || {}, playerMode);
    if (!entry.url || !global.Lampa || !Lampa.Player) {
      notify('Прямой поток недоступен. Страницу источника можно открыть из браузера.');
      return false;
    }
    try {
      activeInternal = playerMode === 'inner';
      if (playerMode === 'external') {
        // Не передаём ленивый плейлист внешнему приложению: системный плеер получает
        // ровно выбранный поток и определяется пользовательской настройкой Lampa.
        Lampa.Player.play(entry);
        return true;
      }

      const playlist = options.playlist && options.playlist.length ? options.playlist : [entry];
      // Передаём плейлист вместе с первым запуском: preload/Preroll в Lampa
      // асинхронны, поэтому отдельный вызов playlist() сразу после play() может
      // произойти раньше появления активного внутреннего плеера.
      entry.playlist = playlist;
      if (typeof Lampa.Player.callback === 'function') {
        // Без собственного callback некоторые сборки вызывают Activity.backward().
        Lampa.Player.callback(() => Lampa.Controller.toggle('content'));
      }
      Lampa.Player.play(entry);
      Lampa.Player.playlist(playlist);
      return true;
    } catch (error) {
      activeInternal = false;
      console.error('[SisiPlus:player]', error);
      notify('Выбранный плеер не смог открыть поток');
      return false;
    }
  }

  function rememberItems(adapterId, items) {
    const id = `${adapterId}:${Date.now()}:${++contextSequence}`;
    contexts.set(id, {
      adapterId,
      items: (items || []).filter((item) => item && item.id && !item.offline).slice()
    });
    if (contexts.size > 40) contexts.delete(contexts.keys().next().value);
    return id;
  }

  async function resolvePlayable(adapter, items, start, attempts) {
    const count = Math.min(items.length, Math.max(1, attempts || 1));
    let lastError;
    for (let step = 0; step < count; step += 1) {
      const index = (start + step) % items.length;
      const item = items[index];
      try {
        const video = await adapter.getVideo(item.id, item);
        if (chooseDefault((video && video.streams) || {})) return { video, item, index };
      } catch (error) { lastError = error; }
    }
    throw lastError || new Error('Доступный поток не найден');
  }

  function lazyEntry(adapter, items, index, playerMode) {
    const source = items[index];
    const entry = {
      title: source.title || source.name || adapter.getName(),
      poster: source.poster || ''
    };
    if (playerMode === 'inner') {
      entry.launch_player = 'inner';
      entry.sisiplusInternal = true;
    }
    entry.url = function resolveUrl(ready) {
      resolvePlayable(adapter, items, index, Math.min(items.length, 8)).then(({ video, item }) => {
        Object.assign(entry, videoEntry(video, item, playerMode));
        ready();
      }).catch((error) => {
        console.warn(`[SisiPlus:${adapter.id}:playlist]`, source.id, error);
        notify('Следующий доступный поток не найден');
        const current = Lampa.PlayerVideo && Lampa.PlayerVideo.video ? Lampa.PlayerVideo.video() : null;
        entry.url = current && current.currentSrc ? current.currentSrc : 'about:blank';
        ready();
      });
    };
    return entry;
  }

  async function playItem(item, adapter, options = {}) {
    if (!item || !adapter) return false;
    if (app.UI && app.UI.Preview) app.UI.Preview.hide();
    if (global.Lampa && Lampa.Loading) Lampa.Loading.start();
    try {
      const playerMode = mode(options.mode);
      const context = contexts.get(item.playbackContextId);
      const items = context && context.adapterId === adapter.id && context.items.length ? context.items : [item];
      const requested = items.findIndex((entry) => String(entry.id) === String(item.id));
      const requestedIndex = requested >= 0 ? requested : 0;
      const first = await resolvePlayable(adapter, items, requestedIndex, Math.min(items.length, 8));
      const playlist = items.map((entry, index) => lazyEntry(adapter, items, index, playerMode));
      Object.assign(playlist[first.index], videoEntry(first.video, first.item, playerMode));
      // Запускаем именно тот объект, который находится в плейлисте. Тогда
      // PlayerPlaylist сразу распознаёт текущую позицию и обе кнопки доступны.
      return play(first.video, {
        entry: playlist[first.index], playlist, fallback: first.item, mode: playerMode
      });
    } catch (error) {
      console.error(`[SisiPlus:${adapter.id}:video]`, error);
      notify(error.message || 'Не удалось получить видео');
      return false;
    } finally {
      if (global.Lampa && Lampa.Loading) Lampa.Loading.stop();
    }
  }

  /**
   * Некоторые TV-сборки начинают внутренний плеер в controller `player`, где
   * стрелки означают перемотку. Первое нажатие стрелки переводит фокус на панель,
   * последующие двигают его по кнопкам, а OK вызывает hover:enter штатной кнопки.
   */
  function init() {
    if (!global.Lampa || !Lampa.Keypad || !Lampa.Keypad.listener || init.done) return;
    init.done = true;
    Lampa.Keypad.listener.follow('keydown', (event) => {
      if (!activeInternal || !event || (event.code !== 37 && event.code !== 39)) return;
      const enabled = Lampa.Controller.enabled && Lampa.Controller.enabled();
      if (!enabled || enabled.name !== 'player') return;
      if (event.event && typeof event.event.preventDefault === 'function') event.event.preventDefault();
      if (Lampa.PlayerPanel && typeof Lampa.PlayerPanel.toggle === 'function') Lampa.PlayerPanel.toggle();
    });
    if (Lampa.Player && Lampa.Player.listener) {
      Lampa.Player.listener.follow('ready', (event) => {
        activeInternal = Boolean(event && event.sisiplusInternal);
      });
      Lampa.Player.listener.follow('destroy', () => { activeInternal = false; });
      Lampa.Player.listener.follow('external', () => { activeInternal = false; });
    }
  }

  app.Player = { init, play, playItem, openWebPage, chooseDefault, rememberItems, resolvePlayable, mode };
})(window);
