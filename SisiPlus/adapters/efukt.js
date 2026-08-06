(function efuktAdapterModule(global) {
  'use strict';
  const app = global.SisiPlus;
  const U = app.AdapterUtils;
  const SITE = 'https://www.efukt.com';

  class EfuktAdapter extends app.Adapter {
    constructor() { super('efukt'); this.items = new Map(); }
    getName() { return 'eFukt'; }
    async getCategories() {
      const fallback = [
        { id: 'latest', title: 'Новинки' }, { id: 'category/funny', title: 'Funny' },
        { id: 'category/fails', title: 'Fails' }, { id: 'category/compilations', title: 'Compilations' }
      ];
      try {
        const html = await app.Api.siteText(`${SITE}/categories/`, { referer: `${SITE}/` });
        const categories = [];
        const seen = new Set();
        const regex = /href="https?:\/\/(?:www\.)?efukt\.com\/category\/([^/"?#]+)\/"[^>]*title="([^"]+)"/gi;
        let match;
        while ((match = regex.exec(html)) && categories.length < 24) {
          if (!seen.has(match[1])) { seen.add(match[1]); categories.push({ id: `category/${match[1]}`, title: U.decodeHtml(match[2]) }); }
        }
        return [fallback[0]].concat(categories.length ? categories : fallback.slice(1));
      } catch (error) { return fallback; }
    }
    parseCards(html) {
      const output = [];
      const seen = new Set();
      const regex = /<a[^>]+href="(https?:\/\/(?:www\.)?efukt\.com\/(\d+)_([^"]+)\.html)"[^>]+title="([^"]+)"[^>]+class="thumb"[^>]+background-image:\s*url\(['"]([^'"]+)/gi;
      let match;
      while ((match = regex.exec(html))) {
        if (seen.has(match[2])) continue;
        seen.add(match[2]);
        const item = { id: match[2], title: U.decodeHtml(match[4]), poster: U.decodeHtml(match[5]), background: U.decodeHtml(match[5]), webpageUrl: match[1] };
        this.items.set(item.id, item);
        output.push(item);
      }
      return output;
    }
    async load(url, page) {
      const items = this.parseCards(await app.Api.siteText(url, { referer: `${SITE}/` }));
      return U.result(items, page, items.length >= 8 ? page + 1 : page);
    }
    getList(category = 'latest', page = 1) {
      const suffix = page > 1 ? `${page}/` : '';
      const base = category === 'latest' ? `${SITE}/` : `${SITE}/${category}/`;
      return this.load(base + suffix, page);
    }
    search(query, page = 1) {
      return this.load(`${SITE}/search/${encodeURIComponent(query)}/${page > 1 ? `${page}/` : ''}`, page);
    }
    async getVideo(id, item = {}) {
      const card = item.webpageUrl ? item : this.items.get(String(id));
      const pageUrl = card && card.webpageUrl ? card.webpageUrl : SITE;
      const html = await app.Api.siteText(pageUrl, { referer: `${SITE}/` });
      const source = html.match(/<source[^>]+src="([^"]+\.(?:mp4|m3u8)[^"]*)"/i);
      const poster = (html.match(/<video[^>]+poster="([^"]+)"/i) || [])[1];
      const stream = source ? U.decodeHtml(source[1]) : '';
      return { title: card ? card.title : 'eFukt', poster: poster || (card && card.poster) || '', streams: stream ? { original: stream } : {}, webpageUrl: pageUrl, headers: { Referer: `${SITE}/` } };
    }
  }
  app.registerAdapter(new EfuktAdapter());
})(window);
