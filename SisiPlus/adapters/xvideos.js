(function xvideosAdapterModule(global) {
  'use strict';
  const app = global.SisiPlus;
  const U = app.AdapterUtils;
  const SITE = 'https://www.xvideos.com';

  class XvideosAdapter extends app.Adapter {
    constructor() { super('xvideos'); this.items = new Map(); }
    getName() { return 'Xvideos'; }
    getCategories() {
      return Promise.resolve([
        { id: 'new', title: 'Новинки', group: 'sort' }, { id: 'best', title: 'Лучшие', group: 'sort' },
        { id: 'c/Amateur-65', title: 'Любительское', group: 'genre' }, { id: 'c/Anal-12', title: 'Анал', group: 'genre' },
        { id: 'c/Asian_Woman-32', title: 'Азиатки', group: 'genre' }, { id: 'c/Big_Tits-23', title: 'Большая грудь', group: 'genre' },
        { id: 'c/Lesbian-26', title: 'Лесбиянки', group: 'genre' }, { id: 'c/Milf-19', title: 'MILF', group: 'genre' }
      ]);
    }
    parseCards(html) {
      const blocks = html.split(/<div[^>]+class="[^"]*thumb-block[^"]*"/i).slice(1);
      const output = [];
      blocks.forEach((block) => {
        const link = block.match(/href="(\/video(?:\.|-?)([a-z0-9]+)\/[^"?#]+)"/i);
        if (!link) return;
        const webpageUrl = U.absolute(SITE, link[1]);
        const posterMatch = block.match(/(?:data-src|src)="([^"]+\.(?:jpg|webp)[^"]*)"/i);
        const titleMatch = block.match(/<p[^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/p>/i) || block.match(/title="([^"]+)"/i);
        const durationMatch = block.match(/class="[^"]*duration[^"]*"[^>]*>([^<]+)/i);
        const previewMatch = block.match(/data-pvv="([^"]+)"/i);
        const id = link[2];
        const poster = posterMatch ? U.absolute(SITE, posterMatch[1].replace(/THUMBNUM/g, '1')) : '';
        const item = {
          id, title: U.stripTags(titleMatch ? titleMatch[1] : link[1].split('/').pop().replace(/_/g, ' ')),
          poster, background: poster, preview: previewMatch ? U.absolute(SITE, previewMatch[1]) : '',
          badge: durationMatch ? durationMatch[1].trim() : '', webpageUrl
        };
        this.items.set(id, item);
        output.push(item);
      });
      return output;
    }
    async load(url, page) {
      const html = await app.Api.siteText(url, { referer: `${SITE}/` });
      const items = this.parseCards(html);
      return U.result(items, page, items.length >= 15 ? page + 1 : page);
    }
    getList(category = 'new', page = 1) {
      const current = Math.max(1, Number(page) || 1);
      if (category.startsWith('c/')) return this.load(`${SITE}/${category}/${current}`, current);
      return this.load(`${SITE}/${category}/${current}`, current);
    }
    search(query, page = 1) { return this.load(`${SITE}/?k=${encodeURIComponent(query)}&p=${Math.max(0, page - 1)}`, page); }
    async getVideo(id, item = {}) {
      const card = item.webpageUrl ? item : this.items.get(String(id));
      const pageUrl = card && card.webpageUrl ? card.webpageUrl : `${SITE}/video.${id}/video`;
      const html = await app.Api.siteText(pageUrl, { referer: `${SITE}/` });
      const streams = {};
      const hls = (html.match(/setVideoHLS\s*\(\s*['"]([^'"]+)/i) || [])[1];
      const high = (html.match(/setVideoUrlHigh\s*\(\s*['"]([^'"]+)/i) || [])[1];
      const low = (html.match(/setVideoUrlLow\s*\(\s*['"]([^'"]+)/i) || [])[1];
      if (hls) streams.HLS = app.Api.mediaUrl(U.decodeHtml(hls), `${SITE}/`, false);
      if (high) streams.High = U.decodeHtml(high);
      if (low) streams.Low = U.decodeHtml(low);
      return { title: card ? card.title : 'Xvideos', poster: card ? card.poster : '', streams, webpageUrl: pageUrl };
    }
  }
  app.registerAdapter(new XvideosAdapter());
})(window);
