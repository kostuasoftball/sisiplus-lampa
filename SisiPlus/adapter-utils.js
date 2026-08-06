(function sisiplusAdapterUtils(global) {
  'use strict';

  const app = global.SisiPlus = global.SisiPlus || {};
  const COUNTRY_NAMES = {
    all: 'Все страны', ru: 'Россия / русский', ua: 'Украина / украинский', by: 'Беларусь',
    kz: 'Казахстан', us: 'США / английский', gb: 'Великобритания', de: 'Германия / немецкий',
    fr: 'Франция / французский', es: 'Испания / испанский', it: 'Италия / итальянский',
    br: 'Бразилия / португальский', co: 'Колумбия', mx: 'Мексика', ar: 'Аргентина',
    pl: 'Польша / польский', cz: 'Чехия', ro: 'Румыния', nl: 'Нидерланды',
    jp: 'Япония / японский', cn: 'Китай', kr: 'Корея', in: 'Индия', ph: 'Филиппины'
  };
  const COUNTRY_OPTIONS = Object.keys(COUNTRY_NAMES).map((id) => ({ id, title: COUNTRY_NAMES[id] }));

  function decodeHtml(value) {
    const text = String(value || '');
    if (typeof document !== 'undefined') {
      const node = document.createElement('textarea');
      node.innerHTML = text;
      return node.value;
    }
    return text
      .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  }

  function stripTags(value) { return decodeHtml(String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()); }
  function absolute(base, value) {
    if (!value) return '';
    try { return new URL(decodeHtml(value).replace(/\\\//g, '/'), base).href; }
    catch (error) { return ''; }
  }
  function duration(value) {
    const parts = String(value || '').trim().split(':').map(Number);
    if (!parts.length || parts.some(Number.isNaN)) return 0;
    return parts.reduce((sum, part) => sum * 60 + part, 0);
  }
  function result(items, page, totalPages) {
    return { items: items || [], page: Math.max(1, Number(page) || 1), totalPages: Math.max(1, Number(totalPages) || 1) };
  }
  function findObject(root, paths) {
    for (const path of paths) {
      let value = root;
      for (const key of path.split('.')) value = value && value[key];
      if (Array.isArray(value)) return value;
    }
    return [];
  }
  function extractAssignedJson(text, marker) {
    const startMarker = text.indexOf(marker);
    if (startMarker < 0) return null;
    let start = startMarker + marker.length;
    while (/\s/.test(text[start] || '')) start += 1;
    const open = text[start];
    const close = open === '{' ? '}' : open === '[' ? ']' : '';
    if (!close) return null;
    let depth = 0;
    let quote = '';
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
      const char = text[index];
      if (quote) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === quote) quote = '';
        continue;
      }
      if (char === '"' || char === "'") { quote = char; continue; }
      if (char === open) depth += 1;
      if (char === close) {
        depth -= 1;
        if (depth === 0) {
          try { return JSON.parse(text.slice(start, index + 1)); }
          catch (error) { return null; }
        }
      }
    }
    return null;
  }
  function countryLabel(code) {
    const normalized = String(code || '').toLowerCase();
    return COUNTRY_NAMES[normalized] || normalized.toUpperCase();
  }
  function countryFilter(options = COUNTRY_OPTIONS) {
    return { id: 'country', title: 'Страна / национальность', options };
  }
  function normalizeLanguage(value) {
    const lang = String(value || '').toLowerCase();
    const map = {
      russian: 'ru', ukrainian: 'ua', english: 'us', german: 'de', french: 'fr', spanish: 'es',
      italian: 'it', portuguese: 'br', polish: 'pl', japanese: 'jp', chinese: 'cn', korean: 'kr', hindi: 'in'
    };
    return map[lang] || lang.slice(0, 2);
  }

  app.AdapterUtils = {
    COUNTRY_NAMES,
    COUNTRY_OPTIONS,
    decodeHtml,
    stripTags,
    absolute,
    duration,
    result,
    findObject,
    extractAssignedJson,
    countryLabel,
    countryFilter,
    normalizeLanguage
  };
})(window);
