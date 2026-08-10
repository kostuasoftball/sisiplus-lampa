(function xhamsterAdapterModule(global) {
  'use strict';
  const app = global.SisiPlus;
  const U = app.AdapterUtils;
  const SITE = 'https://xhamster.com';

  class XhamsterAdapter extends app.Adapter {
    constructor() { super('xhamster'); this.items = new Map(); }
    getName() { return 'Xhamster'; }
    getCategories() {
      return Promise.resolve([
        { id: 'trend', title: 'В тренде', group: 'sort' }, { id: 'newest', title: 'Новинки', group: 'sort' },
        { id: 'best', title: 'Лучшие', group: 'sort' }, { id: 'categories/russian', title: 'Русские', group: 'genre' },
        { id: 'categories/amateur', title: 'Любительское', group: 'genre' }, { id: 'categories/anal', title: 'Анал', group: 'genre' },
        { id: 'categories/milf', title: 'MILF', group: 'genre' }, { id: 'categories/lesbian', title: 'Лесбиянки', group: 'genre' }
      ]);
    }
    parseCards(html) {
      const root = U.extractAssignedJson(html, 'window.initials=') || U.extractAssignedJson(html, 'window.initials =');
      const videos = U.findObject(root, [
        'layoutPage.videoListProps.videoThumbProps', 'searchResult.videoThumbProps',
        'pagesCategoryComponent.trendingVideoListProps.videoThumbProps'
      ]);
      return videos.map((video) => {
        const id = String(video.id || video.videoId || video.pageURL || '');
        const webpageUrl = U.absolute(SITE, video.pageURL);
        const item = {
          id, title: video.title || id, poster: video.thumbURL || '', background: video.thumbURL || '',
          preview: video.trailerURL || video.trailerFallbackUrl || '',
          badge: [video.isUHD ? 'HD' : '', video.duration ? `${Math.floor(video.duration / 60)} мин.` : ''].filter(Boolean).join(' · '),
          webpageUrl, sourceData: video
        };
        this.items.set(id, item);
        return item;
      }).filter((item) => item.webpageUrl);
    }
    async load(url, page) {
      const items = this.parseCards(await app.Api.siteText(url, { referer: `${SITE}/` }));
      return U.result(items, page, items.length >= 15 ? page + 1 : page);
    }
    getList(category = 'trend', page = 1) {
      const path = category === 'trend' ? '' : `/${category}`;
      return this.load(`${SITE}${path}/${page}`, page);
    }
    search(query, page = 1) { return this.load(`${SITE}/search/${encodeURIComponent(query)}?page=${page}`, page); }
    async getVideo(id, item = {}) {
      const card = item.webpageUrl ? item : this.items.get(String(id));
      const pageUrl = card && card.webpageUrl ? card.webpageUrl : SITE;
      const html = await app.Api.siteText(pageUrl, { referer: `${SITE}/` });
      const preload = html.match(/<link[^>]+rel="preload"[^>]+href="([^"]+\.m3u8[^"]*)"/i) ||
        html.match(/<link[^>]+href="([^"]+\.m3u8[^"]*)"[^>]+rel="preload"/i);
      const stream = preload ? U.absolute(SITE, preload[1]) : '';
      return { title: card ? card.title : 'Xhamster', poster: card ? card.poster : '', streams: stream ? { HLS: stream } : {}, webpageUrl: pageUrl };
    }
  }
  app.registerAdapter(new XhamsterAdapter());
})(window);
