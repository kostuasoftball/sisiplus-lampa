(function runetkiAdapterModule(global) {
  'use strict';
  const app = global.SisiPlus;
  const Base = app.LiveAdapters.BongaNetworkAdapter;
  class RunetkiAdapter extends Base {
    constructor() {
      super('runetki', {
        name: 'Runetki', host: 'https://rus.runetki5.com', roomBase: 'https://runetki.com',
        stream: (edge, username) => `https://${edge}.bcvcdn.com/hls/stream_${username}/playlist.m3u8`
      });
    }
  }
  app.registerAdapter(new RunetkiAdapter());
})(window);
