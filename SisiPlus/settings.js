(function sisiplusSettings(global) {
  'use strict';

  const app = global.SisiPlus = global.SisiPlus || {};
  const component = 'sisiplus';
  const registeredAdapters = new Set();
  let initialized = false;

  function storageGet(name, fallback) {
    if (global.Lampa && Lampa.Storage) {
      if (typeof Lampa.Storage.field === 'function') {
        const value = Lampa.Storage.field(name);
        if (value !== undefined && value !== null) return value;
      }
      return Lampa.Storage.get(name, fallback);
    }
    return fallback;
  }

  function get(name, fallback) {
    return storageGet(`sisiplus_${name}`, fallback);
  }

  function addParam(param, field) {
    if (!global.Lampa || !Lampa.SettingsApi) return;
    // Lampa registers both `select` and `input` through Params.select().
    // Its input renderer expects values[name] to be a string. If it is left
    // undefined, opening the settings component crashes in update().
    const normalizedParam = Object.assign({}, param);
    if (normalizedParam.type === 'input' && typeof normalizedParam.values !== 'string') {
      normalizedParam.values = '';
    }
    Lampa.SettingsApi.addParam({ component, param: normalizedParam, field });
  }

  function init() {
    if (initialized || !global.Lampa || !Lampa.SettingsApi) return;
    initialized = true;
    Lampa.SettingsApi.addComponent({
      component,
      name: `SisiPlus · v${global.SisiPlusVersion || 'dev'}`,
      icon: '<svg viewBox="0 0 64 64"><path fill="currentColor" d="M8 14h48v8H8zm0 14h30v8H8zm0 14h48v8H8z"/></svg>'
    });

    addParam(
      { name: 'sisiplus_preview_enabled', type: 'trigger', default: true },
      { name: 'Видеопревью', description: 'Показывать беззвучное превью при фокусе на карточке.' }
    );
    addParam(
      { name: 'sisiplus_preview_android', type: 'trigger', default: false },
      { name: 'Превью на Android', description: 'Может повысить нагрузку и расход трафика на ТВ-приставке.' }
    );
    addParam(
      { name: 'sisiplus_proxy_url', type: 'input', default: '' },
      { name: 'Свой CORS-прокси', description: 'Необязательно. Шаблон с {url}, {referer}, {key} или URL-префикс.' }
    );
    addParam(
      { name: 'sisiplus_public_proxy', type: 'trigger', default: true },
      { name: 'Резервный публичный прокси', description: 'Использовать только если прямой/нативный запрос не сработал.' }
    );
    addParam(
      { name: 'sisiplus_proxy_key', type: 'input', default: '1206' },
      { name: 'Ключ прокси', description: 'Ключ резервного или собственного прокси.' }
    );
    addParam(
      { name: 'sisiplus_chaturbate_wm', type: 'input', default: '9cg6A' },
      { name: 'Chaturbate WM', description: 'Affiliate WM для официального списка онлайн-комнат.' }
    );
    addParam(
      {
        name: 'sisiplus_search_pages',
        type: 'select',
        values: { 1: 'быстрый', 3: 'средний', 6: 'глубокий', 12: 'максимальный' },
        default: 3
      },
      { name: 'Глубина поиска', description: 'Большая глубина точнее, но создаёт больше запросов.' }
    );
  }

  function registerAdapter(adapter) {
    if (!initialized || registeredAdapters.has(adapter.id)) return;
    registeredAdapters.add(adapter.id);
    addParam(
      { name: `sisiplus_adapter_${adapter.id}`, type: 'trigger', default: true },
      { name: adapter.getName(), description: 'Показывать этот источник в SisiPlus.' }
    );
  }

  function isAdapterEnabled(id) {
    return get(`adapter_${id}`, true) !== false;
  }

  app.Settings = { init, registerAdapter, get, isAdapterEnabled };
})(window);
