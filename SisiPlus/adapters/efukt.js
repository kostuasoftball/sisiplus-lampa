(function efuktAdapterModule(global) {
  'use strict';
  const app = global.SisiPlus;
  const U = app.AdapterUtils;
  // www.efukt.com сейчас отвечает перенаправлением. В WebView браузер следует ему
  // автоматически, а Lampa.Reguest.native на части Android TV возвращает пустое
  // тело 301/302. Поэтому всегда используем конечный canonical host.
  const SITE = 'https://efukt.com';

  class EfuktAdapter extends app.Adapter {
    constructor() { super('efukt'); this.items = new Map(); }
    getName() { return 'eFukt'; }
    async getCategories() {
      const fallback = [
        { id: 'latest', title: 'Новинки', group: 'sort' },
        { id: 'category/funny', title: 'Funny', group: 'genre' },
        { id: 'category/fail', title: 'Fails', group: 'genre' },
        { id: 'category/compilations', title: 'Compilations', group: 'genre' }
      ];
      try {
        const html = await app.Api.siteText(`${SITE}/categories/`, { referer: `${SITE}/` });
        const categories = [];
        const seen = new Set();
        const regex = /href="https?:\/\/(?:www\.)?efukt\.com\/category\/([^/"?#]+)\/"[^>]*title="([^"]+)"/gi;
        let match;
        while ((match = regex.exec(html)) && categories.length < 24) {
          if (!seen.has(match[1])) {
            seen.add(match[1]);
            categories.push({ id: `category/${match[1]}`, title: U.decodeHtml(match[2]), group: 'genre' });
          }
        }
        return [fallback[0]].concat(categories.length ? categories : fallback.slice(1));
      } catch (error) { return fallback; }
    }
    parseCards(html) {
      const output = [];
      const seen = new Set();
      // Разбираем каждый тег независимо от порядка его атрибутов. Это устойчивее
      // прежнего длинного regex: сайт периодически переставляет class/title/style.
      const anchors = String(html || '').match(/<a\b[^>]*>/gi) || [];
      anchors.forEach((anchor) => {
        if (!/\bclass=["'][^"']*\bthumb\b/i.test(anchor)) return;
        const href = (anchor.match(/\bhref=["']([^"']+)["']/i) || [])[1];
        const pageUrl = U.absolute(SITE, href);
        const page = pageUrl.match(/^https?:\/\/(?:www\.)?efukt\.com\/(\d+)_[^/?#]+\.html/i);
        const posterValue = (anchor.match(/background-image\s*:\s*url\(\s*["']?([^"')\s]+)/i) || [])[1];
        if (!page || !posterValue || seen.has(page[1])) return;
        const titleValue = (anchor.match(/\btitle=["']([^"']*)["']/i) || [])[1] || `eFukt #${page[1]}`;
        seen.add(page[1]);
        const poster = U.absolute(SITE, posterValue);
        const item = {
          id: page[1], title: U.decodeHtml(titleValue), poster, background: poster, webpageUrl: pageUrl
        };
        this.items.set(item.id, item);
        output.push(item);
      });
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
