(function bongacamsAdapterModule(global) {
  'use strict';
  const app = global.SisiPlus;
  const Base = app.LiveAdapters.BongaNetworkAdapter;
  class BongaCamsAdapter extends Base {
    constructor() {
      super('bongacams', {
        name: 'BongaCams', host: 'https://ukr.bongacams.com', roomBase: 'https://bongacams.com',
        stream: (edge, username) => `https://${edge}.bcvcdn.com/hls/stream_${username}/public-aac/stream_${username}/chunks.m3u8`
      });
    }
  }
  app.registerAdapter(new BongaCamsAdapter());
})(window);
