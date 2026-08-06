(function sisiplusPlayer(global) {
  'use strict';
  const app = global.SisiPlus = global.SisiPlus || {};

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

  function play(video) {
    const streams = video && video.streams ? video.streams : {};
    const url = chooseDefault(streams);
    if (!url || !global.Lampa || !Lampa.Player) {
      if (video && openWebPage(video.webpageUrl)) return true;
      notify('Прямой поток недоступен. Не удалось открыть и страницу источника.');
      return false;
    }
    const quality = {};
    Object.keys(streams).forEach((key) => { if (streams[key]) quality[key] = streams[key]; });
    const item = {
      title: video.title || 'SisiPlus',
      url,
      quality,
      poster: video.poster || '',
      headers: video.headers || undefined
    };
    try {
      Lampa.Player.play(item);
      Lampa.Player.playlist([item]);
      return true;
    } catch (error) {
      console.error('[SisiPlus:player]', error);
      if (openWebPage(video.webpageUrl)) return true;
      notify('Плеер Lampa не смог открыть поток');
      return false;
    }
  }

  async function playItem(item, adapter) {
    if (!adapter) return false;
    if (app.UI && app.UI.Preview) app.UI.Preview.hide();
    if (global.Lampa && Lampa.Loading) Lampa.Loading.start();
    try {
      return play(await adapter.getVideo(item.id, item));
    } catch (error) {
      console.error(`[SisiPlus:${adapter.id}:video]`, error);
      if (openWebPage(item.webpageUrl)) return true;
      notify(error.message || 'Не удалось получить видео');
      return false;
    } finally {
      if (global.Lampa && Lampa.Loading) Lampa.Loading.stop();
    }
  }

  app.Player = { play, playItem, openWebPage, chooseDefault };
})(window);
