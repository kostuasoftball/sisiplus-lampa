(function sisiplusLiveTV(global) {
  'use strict';

  const app = global.SisiPlus = global.SisiPlus || {};
  const TARGET_QUEUE_SIZE = 50;
  const MAX_QUEUE_SIZE = 100;
  const MAX_QUEUE_PAGES = 5;
  let session = null;
  let styleReady = false;

  function notify(message) {
    if (global.Lampa && Lampa.Noty) Lampa.Noty.show(message);
    else console.warn('[SisiPlus:LiveTV]', message);
  }

  function intervalSeconds() {
    const value = Number(app.Settings ? app.Settings.get('livetv_interval', 10) : 10);
    return Number.isFinite(value) && value >= 0 ? value : 10;
  }

  function injectStyle() {
    if (styleReady || typeof document === 'undefined' || !document.head) return;
    styleReady = true;
    const style = document.createElement('style');
    style.textContent = [
      '.sisiplus-livetv-card{background:linear-gradient(135deg,#7b2cff,#e9337c 58%,#ff9a32);}',
      '.sisiplus-livetv-overlay{position:absolute;left:2.4em;top:2.2em;z-index:25;padding:.65em 1em;border-radius:.55em;background:rgba(0,0,0,.68);color:#fff;pointer-events:none;min-width:15em}',
      '.sisiplus-livetv-overlay__title{font-size:1.15em;font-weight:700}',
      '.sisiplus-livetv-overlay__status{font-size:.85em;opacity:.82;margin-top:.25em}'
    ].join('');
    document.head.appendChild(style);
  }

  function card(adapter) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#7b2cff"/><stop offset=".58" stop-color="#e9337c"/><stop offset="1" stop-color="#ff9a32"/></linearGradient></defs><rect width="640" height="360" rx="28" fill="url(#g)"/><circle cx="235" cy="180" r="68" fill="rgba(255,255,255,.2)"/><path d="M220 138l68 42-68 42z" fill="white"/><text x="330" y="170" font-family="Arial" font-size="48" font-weight="700" fill="white">LIVE TV</text><text x="330" y="215" font-family="Arial" font-size="22" fill="white">${adapter.getName()}</text></svg>`;
    return {
      id: `livetv:${adapter.id}`,
      title: 'Live TV · автопереключение',
      badge: intervalSeconds() ? `Следующая модель через ${intervalSeconds()} сек.` : 'Ручное переключение',
      poster: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
      background: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
      sisiplusAction: 'livetv',
      className: 'sisiplus-livetv-card'
    };
  }

  function unwrapPlayer() {
    if (!global.Lampa || !Lampa.Player || typeof Lampa.Player.render !== 'function') return null;
    const rendered = Lampa.Player.render();
    return rendered && rendered[0] ? rendered[0] : rendered;
  }

  function renderOverlay() {
    if (!session || typeof document === 'undefined') return;
    injectStyle();
    const root = unwrapPlayer();
    if (!root || typeof root.querySelector !== 'function') return;
    if (session.manualMode) {
      const previous = root.querySelector('.sisiplus-livetv-overlay');
      if (previous) previous.remove();
      return;
    }
    let overlay = root.querySelector('.sisiplus-livetv-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'sisiplus-livetv-overlay';
      overlay.innerHTML = '<div class="sisiplus-livetv-overlay__title"></div><div class="sisiplus-livetv-overlay__status"></div>';
      root.appendChild(overlay);
    }
    const current = session.items[session.index] || {};
    const title = overlay.querySelector('.sisiplus-livetv-overlay__title');
    const status = overlay.querySelector('.sisiplus-livetv-overlay__status');
    if (title) title.textContent = `${session.adapter.getName()} · ${current.title || 'Live TV'}`;
    if (status) status.textContent = session.timerPaused
      ? `Таймер остановлен (${session.remaining} сек.) · после Play останется ручной режим`
      : session.seconds > 0
      ? `Следующая через ${session.remaining} сек. · Pause, затем Play — отключить автоматику`
      : 'Автопереключение выключено · используйте кнопки плеера';
  }

  function clearTimer() {
    if (!session) return;
    clearInterval(session.timer);
    session.timer = 0;
  }

  function stop() {
    if (!session) return;
    clearTimeout(session.closeTimer);
    clearTimeout(session.pauseDetectTimer);
    clearTimer();
    const root = unwrapPlayer();
    if (root && root.querySelector) {
      const overlay = root.querySelector('.sisiplus-livetv-overlay');
      if (overlay) overlay.remove();
    }
    session = null;
  }

  function triggerButton(className) {
    const root = unwrapPlayer();
    if (!root || !root.querySelectorAll) return false;
    const buttons = Array.from(root.querySelectorAll(className));
    const button = buttons.find((node) => !node.classList.contains('hide')) || buttons[0];
    if (!button) return false;
    try {
      button.dispatchEvent(new CustomEvent('hover:enter', { bubbles: true }));
      return true;
    } catch (error) {
      try {
        if (global.$) { global.$(button).trigger('hover:enter'); return true; }
      } catch (ignored) {}
    }
    return false;
  }

  function restartTimer(reset = true) {
    if (!session) return;
    clearTimer();
    if (reset || !Number.isFinite(session.remaining)) session.remaining = session.seconds;
    renderOverlay();
    if (!session.seconds || session.timerPaused || session.manualMode) return;
    session.timer = setInterval(() => {
      if (!session) return;
      session.remaining -= 1;
      renderOverlay();
      if (session.remaining > 0) return;
      session.remaining = session.seconds;
      if (session.index >= session.playlist.length - 1) {
        selectAt(0);
      } else if (!triggerButton('.player-panel__next')) {
        selectAt(session.index + 1);
      }
    }, 1000);
  }

  function streamItem(item, adapter, index) {
    const entry = {
      title: item.title || adapter.getName(),
      poster: item.poster || '',
      launch_player: 'inner',
      callback() {
        if (!session) return;
        session.index = index;
        restartTimer();
      }
    };
    entry.url = function resolveUrl(ready) {
      resolvePlayable(adapter, session ? session.items : [item], index, 6).then(({ video, item: playable }) => {
        const streams = video.streams || {};
        const url = app.Player.chooseDefault(streams);
        entry.url = url;
        entry.title = playable.title || entry.title;
        entry.poster = playable.poster || entry.poster;
        entry.quality = { ...streams };
        entry.headers = video.headers || undefined;
        ready();
      }).catch((error) => {
        console.warn(`[SisiPlus:${adapter.id}:livetv]`, item.id, error);
        stop();
        notify('Не удалось найти следующий рабочий поток Live TV');
      });
    };
    return entry;
  }

  async function resolvePlayable(adapter, items, start, attempts) {
    const count = Math.min(items.length, Math.max(1, attempts || 1));
    let lastError;
    for (let step = 0; step < count; step += 1) {
      const index = (start + step) % items.length;
      const item = items[index];
      try {
        const video = await adapter.getVideo(item.id, item);
        if (app.Player.chooseDefault(video.streams || {})) return { video, item, index };
      } catch (error) { lastError = error; }
    }
    throw lastError || new Error('Доступный поток не найден');
  }

  function playAt(index) {
    if (!session || !session.playlist.length) return;
    const target = session.playlist[index] || session.playlist[0];
    session.index = index < session.playlist.length ? index : 0;
    try {
      Lampa.Player.play(target);
      Lampa.Player.playlist(session.playlist);
      restartTimer();
    } catch (error) {
      console.error('[SisiPlus:LiveTV]', error);
      stop();
      notify('Внутренний плеер Lampa не смог запустить Live TV');
    }
  }

  function selectAt(index) {
    if (!session || !session.playlist.length) return false;
    const normalized = (index + session.playlist.length) % session.playlist.length;
    const item = session.playlist[normalized];
    try {
      if (Lampa.PlayerPlaylist && Lampa.PlayerPlaylist.listener) {
        Lampa.PlayerPlaylist.listener.send('select', {
          playlist: session.playlist, position: normalized, item
        });
      } else {
        playAt(normalized);
      }
      session.index = normalized;
      session.remaining = session.seconds;
      renderOverlay();
      return true;
    } catch (error) {
      console.error('[SisiPlus:LiveTV:select]', error);
      return false;
    }
  }

  async function loadQueue(adapter) {
    const unique = new Map();
    for (let page = 1; page <= MAX_QUEUE_PAGES && unique.size < TARGET_QUEUE_SIZE; page += 1) {
      try {
        const result = await adapter.getLiveTVItems({ page, limit: 72 });
        const pageItems = (Array.isArray(result) ? result : (result && result.items) || [])
          .filter((item) => item && item.id);
        pageItems.forEach((item) => unique.set(String(item.id), item));
        if (!pageItems.length) break;
        if (result && !Array.isArray(result) && result.totalPages && page >= result.totalPages) break;
      } catch (error) {
        if (!unique.size) throw error;
        console.warn(`[SisiPlus:${adapter.id}:livetv] не удалось добрать страницу очереди`, error);
        break;
      }
    }
    return Array.from(unique.values()).slice(0, MAX_QUEUE_SIZE);
  }

  async function start(adapter) {
    const capabilities = adapter && typeof adapter.getCapabilities === 'function' ? adapter.getCapabilities() : {};
    if (!capabilities.liveTv || typeof adapter.getLiveTVItems !== 'function') {
      notify('Этот источник не поддерживает Live TV');
      return false;
    }
    if (!global.Lampa || !Lampa.Player) return false;
    if (app.UI && app.UI.Preview) app.UI.Preview.hide();
    if (Lampa.Loading) Lampa.Loading.start();
    stop();
    try {
      const items = await loadQueue(adapter);
      if (!items.length) throw new Error('Источник не вернул доступных онлайн-моделей');
      const first = await resolvePlayable(adapter, items, 0, Math.min(items.length, 10));
      if (first.index) items.push(...items.splice(0, first.index));
      session = {
        adapter, items, playlist: [], index: 0, timer: 0, closeTimer: 0,
        seconds: intervalSeconds(), remaining: intervalSeconds(), timerPaused: false,
        manualMode: false, pauseDetectTimer: 0
      };
      session.playlist = items.map((item, index) => streamItem(item, adapter, index));
      // Первый поток разрешается заранее: Player.play ожидает строковый URL.
      const firstVideo = first.video;
      const firstUrl = app.Player.chooseDefault(firstVideo.streams || {});
      Object.assign(session.playlist[0], {
        url: firstUrl,
        quality: { ...(firstVideo.streams || {}) },
        headers: firstVideo.headers || undefined
      });
      playAt(0);
      return true;
    } catch (error) {
      stop();
      console.error(`[SisiPlus:${adapter.id}:livetv]`, error);
      notify(error.message || 'Не удалось запустить Live TV');
      return false;
    } finally {
      if (Lampa.Loading) Lampa.Loading.stop();
    }
  }

  function init() {
    if (!global.Lampa || !Lampa.Player || !Lampa.Player.listener || init.done) return;
    init.done = true;
    Lampa.Player.listener.follow('create', (event) => {
      if (!session || !event || !session.playlist.includes(event.data)) return;
      clearTimeout(session.closeTimer);
      session.closeTimer = 0;
    });
    Lampa.Player.listener.follow('ready', (data) => {
      if (!session || !session.playlist.includes(data)) return;
      clearTimeout(session.closeTimer);
      session.closeTimer = 0;
      restartTimer();
    });
    // Lampa посылает destroy не только при выходе, но и перед выбором другого
    // пункта внутреннего плейлиста. Короткая отсрочка отличает переход (за ним
    // приходит ready) от настоящего закрытия плеера.
    Lampa.Player.listener.follow('destroy', () => {
      if (!session) return;
      clearTimer();
      clearTimeout(session.closeTimer);
      session.closeTimer = setTimeout(stop, 1500);
    });
    Lampa.Player.listener.follow('external', stop);
    if (Lampa.PlayerVideo && Lampa.PlayerVideo.listener) {
      // При смене пункта плейлиста Lampa кратковременно посылает pause/play.
      // Задержка отделяет этот технический переход от настоящей паузы пользователя.
      Lampa.PlayerVideo.listener.follow('pause', () => {
        if (!session || session.manualMode) return;
        clearTimeout(session.pauseDetectTimer);
        session.pauseDetectTimer = setTimeout(() => {
          if (!session || session.manualMode) return;
          const video = Lampa.PlayerVideo.video && Lampa.PlayerVideo.video();
          if (video && video.paused) {
            session.timerPaused = true;
            clearTimer();
            renderOverlay();
          }
        }, 250);
      });
      Lampa.PlayerVideo.listener.follow('play', () => {
        if (!session) return;
        clearTimeout(session.pauseDetectTimer);
        session.pauseDetectTimer = 0;
        if (session.timerPaused) {
          // Pause → Play является явным переходом пользователя в ручной режим.
          session.timerPaused = false;
          session.manualMode = true;
          clearTimer();
          renderOverlay();
        }
      });
    }
  }

  app.LiveTV = { init, start, stop, card, intervalSeconds, triggerButton, loadQueue };
})(window);
