(function chaturbateAdapterModule(global) {
  'use strict';
  const app = global.SisiPlus;
  const U = app.AdapterUtils;
  const SITE = 'https://chaturbate.com';
  const API = `${SITE}/api/public/affiliates/onlinerooms/`;
  const COUNTRIES = app.LiveAdapters.LIVE_COUNTRIES;

  class ChaturbateAdapter extends app.Adapter {
    constructor() { super('chaturbate'); this.models = new Map(); }
    getName() { return 'Chaturbate'; }
    getCapabilities() { return { account: true, favorites: true }; }
    getCategories() {
      return Promise.resolve([
        { id: 'all', title: 'Популярные', group: 'type' }, { id: 'f', title: 'Девушки', group: 'type' },
        { id: 'm', title: 'Парни', group: 'type' }, { id: 'c', title: 'Пары', group: 'type' },
        { id: 't', title: 'Транс-модели', group: 'type' }
      ]);
    }
    getFilters() { return Promise.resolve([U.countryFilter(COUNTRIES)]); }
    requestModels(category, offset, limit, tag = '') {
      const url = new URL(API);
      url.searchParams.set('wm', String(app.Settings ? app.Settings.get('chaturbate_wm', '9cg6A') : '9cg6A'));
      url.searchParams.set('client_ip', 'request_ip');
      url.searchParams.set('limit', String(limit));
      url.searchParams.set('offset', String(offset));
      if (category && category !== 'all') url.searchParams.set('gender', category);
      if (tag) url.searchParams.set('tag', tag);
      return app.Api.cached(`cb:${url}`, () => app.Api.siteJson(url.href, { referer: `${SITE}/` }), 20_000);
    }
    mapModel(model) {
      const country = String(model.country || '').toLowerCase();
      const item = {
        id: model.username, title: model.display_name || model.username,
        poster: model.image_url_360x270 || model.image_url || '', background: model.image_url || '',
        badge: model.num_users ? `${model.num_users} зр.` : (model.is_hd ? 'HD' : 'LIVE'),
        webpageUrl: `${SITE}/${encodeURIComponent(model.username)}/`, country, sourceData: model
      };
      this.models.set(model.username, model);
      return item;
    }
    async getList(category = 'all', page = 1, filters = {}) {
      const country = filters.country && filters.country !== 'all' ? filters.country : '';
      const limit = country ? 500 : 90;
      const data = await this.requestModels(category, (page - 1) * limit, limit);
      // The affiliate feed may include rooms that have just switched to a
      // private/hidden show. Their pages deliberately expose an empty HLS URL,
      // so do not present those stale cards as playable live rooms.
      let models = (data.results || []).filter((model) => !model.current_show || model.current_show === 'public');
      if (country) models = models.filter((model) => String(model.country || '').toLowerCase() === country);
      return U.result(models.slice(0, 90).map((model) => this.mapModel(model)), page, models.length >= limit ? page + 1 : page);
    }
    async search(query, page = 1, filters = {}) {
      const needle = String(query || '').trim().toLowerCase();
      const country = filters.country && filters.country !== 'all' ? filters.country : '';
      const data = await this.requestModels('all', 0, 500, needle.replace(/\s+/g, '-'));
      const matches = (data.results || []).filter((model) => {
        if (model.current_show && model.current_show !== 'public') return false;
        const text = `${model.username} ${model.display_name || ''} ${(model.tags || []).join(' ')}`.toLowerCase();
        return text.includes(needle) && (!country || String(model.country || '').toLowerCase() === country);
      });
      return U.result(matches.map((model) => this.mapModel(model)), page, page);
    }
    async getVideo(id, item = {}) {
      const username = item.id || id;
      const pageUrl = item.webpageUrl || `${SITE}/${encodeURIComponent(username)}/`;
      const html = await app.Api.siteText(pageUrl, {
        referer: `${SITE}/`, headers: { Cookie: 'agreeterms=1; over18=1' }
      });
      let stream = '';
      const assignment = html.match(/initialRoomDossier\s*=\s*("(?:\\.|[^"\\])*")/);
      if (assignment) {
        try {
          const dossier = JSON.parse(JSON.parse(assignment[1]));
          stream = dossier.hls_source || '';
        } catch (error) {}
      }
      if (!stream) {
        // Chaturbate encodes quotes as \u0022. Stop at the encoded closing
        // quote as well; otherwise an empty HLS value captures the remainder
        // of the room dossier and is later mistaken for a media URL.
        const escaped = html.match(/hls_source\\u0022\s*:\s*\\u0022([\s\S]*?)\\u0022/);
        if (escaped) {
          try { stream = JSON.parse(`"${escaped[1]}"`); } catch (error) {}
        }
      }
      return { title: item.title || username, poster: item.poster || '', streams: stream ? { HLS: stream } : {}, webpageUrl: pageUrl, headers: { Referer: `${SITE}/` } };
    }

    sessionCookie(session) {
      const value = String(session || '').replace(/^cookie\s*:\s*/i, '').trim();
      return [value, 'agreeterms=1', 'over18=1'].filter(Boolean).join('; ');
    }

    async accountPage(session) {
      return app.Api.siteText(`${SITE}/followed-cams/`, {
        referer: `${SITE}/`, proxy: 'never', retries: 0,
        headers: { Cookie: this.sessionCookie(session) }
      });
    }

    async validateSession(session) {
      const html = await this.accountPage(session);
      if (/cf-chl-|captcha|just a moment/i.test(html)) throw new Error('Chaturbate запросил дополнительную проверку браузера');
      if (/\/auth\/login\/?|name=["']password["']/i.test(html)) {
        return { valid: false, message: 'Сессия Chaturbate недействительна или истекла' };
      }
      const accountPatterns = [
        /data-current-user=["']([^"']+)["']/i,
        /["'](?:viewer_username|current_username)["']\s*:\s*["']([^"']+)["']/i,
        /\/accounts\/user\/([^/"']+)/i
      ];
      let account = '';
      for (const pattern of accountPatterns) {
        const match = html.match(pattern);
        if (match) { account = match[1]; break; }
      }
      return { valid: true, account };
    }

    extractFollowedNames(payload) {
      const names = new Set();
      const text = typeof payload === 'string' ? payload : JSON.stringify(payload || {});
      const patterns = [
        /data-(?:room|roomname|username)=["']([a-z0-9_\-]{2,64})["']/gi,
        /["'](?:room|room_name|roomname)["']\s*:\s*["']([a-z0-9_\-]{2,64})["']/gi
      ];
      if (!/<(?:html|body|div|a)\b/i.test(text)) {
        patterns.push(/["']username["']\s*:\s*["']([a-z0-9_\-]{2,64})["']/gi);
      }
      patterns.forEach((pattern) => {
        let match;
        while ((match = pattern.exec(text))) {
          const name = match[1].toLowerCase();
          names.add(name);
        }
      });
      return names;
    }

    async getFavorites(session) {
      const html = await this.accountPage(session);
      if (/\/auth\/login\/?|name=["']password["']/i.test(html)) {
        const error = new Error('Сессия Chaturbate истекла');
        error.status = 401;
        throw error;
      }
      const names = this.extractFollowedNames(html);
      // В некоторых сборках сайт подгружает подписки отдельным room-list запросом.
      if (!names.size) {
        try {
          const roomList = await app.Api.siteText(`${SITE}/api/ts/roomlist/room-list/?follow=true&limit=500&offset=0`, {
            referer: `${SITE}/followed-cams/`, proxy: 'never', retries: 0,
            headers: { Cookie: this.sessionCookie(session), 'X-Requested-With': 'XMLHttpRequest' }
          });
          this.extractFollowedNames(roomList).forEach((name) => names.add(name));
        } catch (error) {}
      }
      if (!names.size) return [];
      const feed = await this.requestModels('all', 0, 500);
      const online = new Map((feed.results || []).map((model) => [String(model.username).toLowerCase(), model]));
      return Array.from(names, (name) => {
        const model = online.get(name);
        if (model && (!model.current_show || model.current_show === 'public')) return this.mapModel(model);
        return {
          id: name, title: name, poster: '', background: '', badge: 'OFFLINE',
          offline: true, webpageUrl: `${SITE}/${encodeURIComponent(name)}/`
        };
      }).sort((left, right) => Number(left.offline) - Number(right.offline));
    }
  }
  app.registerAdapter(new ChaturbateAdapter());
})(window);
