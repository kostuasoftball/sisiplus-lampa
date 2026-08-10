(function pornhubAdapterModule(global) {
  'use strict';
  const app = global.SisiPlus;
  const U = app.AdapterUtils;
  const SITE = 'https://www.pornhub.com';
  const API = `${SITE}/webmasters/search`;

  class PornhubAdapter extends app.Adapter {
    constructor() { super('pornhub'); this.items = new Map(); }
    getName() { return 'Pornhub'; }
    getCategories() {
      return Promise.resolve([
        { id: 'sort:mostrecent', title: 'Новинки', group: 'sort' },
        { id: 'sort:mostviewed', title: 'Популярные', group: 'sort' },
        { id: 'sort:rating', title: 'По рейтингу', group: 'sort' },
        { id: 'category:russian', title: 'Русские', group: 'genre' },
        { id: 'category:amateur', title: 'Любительское', group: 'genre' },
        { id: 'category:anal', title: 'Анал', group: 'genre' },
        { id: 'category:milf', title: 'MILF', group: 'genre' },
        { id: 'category:lesbian', title: 'Лесбиянки', group: 'genre' },
        { id: 'category:transgender', title: 'Транс', group: 'genre' }
      ]);
    }
    mapVideo(video) {
      const page = U.absolute(SITE, video.url || '');
      const id = String(video.video_id || ((page.match(/viewkey=([^&]+)/) || [])[1]) || page);
      const thumbs = [video.default_thumb, video.thumb].concat((video.thumbs || []).map((item) => item.src));
      const poster = thumbs.find((url) => url && url.includes('hdnea=')) || thumbs.find(Boolean) || '';
      const item = {
        id, title: video.title || id, poster, background: poster,
        badge: [video.duration, video.views ? `${video.views} просм.` : ''].filter(Boolean).join(' · '),
        webpageUrl: page, sourceData: video
      };
      this.items.set(id, item);
      return item;
    }
    async request(query, page, ordering, category) {
      const url = new URL(API);
      url.searchParams.set('search', query || '');
      url.searchParams.set('page', String(page));
      url.searchParams.set('ordering', ordering || 'mostrecent');
      url.searchParams.set('thumbsize', 'medium_hd');
      if (category) url.searchParams.set('category', category);
      const data = await app.Api.cached(`ph:${url}`, () => app.Api.siteJson(url.href, { referer: `${SITE}/` }), 45_000);
      const videos = data.videos || (data.data && data.data.videos) || [];
      return U.result(videos.map((video) => this.mapVideo(video)), page, videos.length >= 20 ? page + 1 : page);
    }
    getList(category = 'sort:mostrecent', page = 1) {
      const parts = String(category).split(':');
      return this.request('', page, parts[0] === 'sort' ? parts[1] : 'mostrecent', parts[0] === 'category' ? parts[1] : '');
    }
    search(query, page = 1) { return this.request(query, page, 'mostrecent', ''); }
    async getVideo(id, item = {}) {
      const card = item.webpageUrl ? item : this.items.get(String(id));
      const pageUrl = card && card.webpageUrl ? card.webpageUrl : `${SITE}/view_video.php?viewkey=${encodeURIComponent(id)}`;
      const html = await app.Api.siteText(pageUrl, { referer: `${SITE}/` });
      const marker = (html.match(/var\s+(flashvars_\d+)\s*=/) || [])[1];
      const flashvars = marker ? U.extractAssignedJson(html, `var ${marker} =`) || U.extractAssignedJson(html, `var ${marker}=`) : null;
      const streams = {};
      ((flashvars && flashvars.mediaDefinitions) || []).forEach((definition) => {
        const source = String(definition.videoUrl || '').replace(/\\\//g, '/');
        if (!source || !definition.quality) return;
        const label = `${definition.quality}p`;
        streams[label] = app.Api.mediaUrl(source, `${SITE}/`, !app.Api.isAndroid());
      });
      return { title: card ? card.title : 'Pornhub', poster: card ? card.poster : '', streams, webpageUrl: pageUrl };
    }
  }
  app.registerAdapter(new PornhubAdapter());
})(window);
