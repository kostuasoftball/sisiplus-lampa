(function sisiplusAuth(global) {
  'use strict';

  const app = global.SisiPlus = global.SisiPlus || {};
  const states = new Map();
  const statusListeners = new Map();

  function key(adapterId) { return `account_session_${adapterId}`; }

  function getSession(adapterId) {
    return String(app.Settings ? app.Settings.get(key(adapterId), '') : '').trim();
  }

  function setSession(adapterId, value) {
    if (!app.Settings) return;
    app.Settings.set(key(adapterId), String(value || '').trim());
    setState(adapterId, value ? { state: 'unknown', message: 'Сессия сохранена, требуется проверка' } : {
      state: 'none', message: 'Не настроено'
    });
  }

  function getState(adapterId) {
    if (states.has(adapterId)) return states.get(adapterId);
    return getSession(adapterId)
      ? { state: 'unknown', message: 'Сессия сохранена, требуется проверка' }
      : { state: 'none', message: 'Не настроено' };
  }

  function setState(adapterId, next) {
    const value = { state: next.state || 'unknown', message: next.message || '', account: next.account || '' };
    states.set(adapterId, value);
    (statusListeners.get(adapterId) || []).forEach((listener) => {
      try { listener(value); } catch (error) {}
    });
    return value;
  }

  function follow(adapterId, listener) {
    if (!statusListeners.has(adapterId)) statusListeners.set(adapterId, []);
    statusListeners.get(adapterId).push(listener);
    listener(getState(adapterId));
    return () => {
      const list = statusListeners.get(adapterId) || [];
      const index = list.indexOf(listener);
      if (index >= 0) list.splice(index, 1);
    };
  }

  async function validate(adapter, quiet = false) {
    const session = getSession(adapter.id);
    if (!session) return setState(adapter.id, { state: 'none', message: 'Не настроено' });
    if (!adapter || typeof adapter.validateSession !== 'function') {
      return setState(adapter.id, { state: 'unsupported', message: 'Источник не поддерживает аккаунт' });
    }
    setState(adapter.id, { state: 'checking', message: 'Проверка подключения…' });
    try {
      const result = await adapter.validateSession(session);
      if (!result || result.valid !== true) {
        const invalid = setState(adapter.id, {
          state: 'invalid', message: (result && result.message) || 'Сессия недействительна или истекла'
        });
        if (!quiet && global.Lampa && Lampa.Noty) Lampa.Noty.show(invalid.message);
        return invalid;
      }
      const account = result.account || result.username || '';
      const ready = setState(adapter.id, {
        state: 'ready', account,
        message: account ? `Подключено: ${account}` : 'Аккаунт подключён'
      });
      if (!quiet && global.Lampa && Lampa.Noty) Lampa.Noty.show(ready.message);
      return ready;
    } catch (error) {
      console.warn(`[SisiPlus:${adapter.id}:auth]`, error);
      const failed = setState(adapter.id, {
        state: 'error', message: error.message || 'Не удалось проверить подключение'
      });
      if (!quiet && global.Lampa && Lampa.Noty) Lampa.Noty.show(failed.message);
      return failed;
    }
  }

  function prompt(adapter) {
    if (!global.Lampa || !Lampa.Input) return;
    Lampa.Input.edit({
      title: `${adapter.getName()} — Cookie авторизованной сессии`,
      value: '', free: true, nosave: true
    }, (value) => {
      try { Lampa.Controller.toggle('settings_component'); } catch (error) {}
      const session = String(value || '').trim();
      if (!session) return;
      setSession(adapter.id, session);
      validate(adapter);
    });
  }

  function clear(adapter) {
    setSession(adapter.id, '');
    if (adapter && typeof adapter.clearSession === 'function') adapter.clearSession();
    if (global.Lampa && Lampa.Noty) Lampa.Noty.show(`${adapter.getName()}: данные аккаунта удалены`);
  }

  async function favorites(adapter) {
    const capabilities = adapter && typeof adapter.getCapabilities === 'function' ? adapter.getCapabilities() : {};
    if (!capabilities.favorites || typeof adapter.getFavorites !== 'function' || !getSession(adapter.id)) return [];
    let state = getState(adapter.id);
    if (state.state !== 'ready') state = await validate(adapter, true);
    if (state.state !== 'ready') return [];
    try {
      const result = await adapter.getFavorites(getSession(adapter.id));
      return Array.isArray(result) ? result : (result && result.items) || [];
    } catch (error) {
      console.warn(`[SisiPlus:${adapter.id}:favorites]`, error);
      if (error && (error.status === 401 || error.status === 403)) {
        setState(adapter.id, { state: 'invalid', message: 'Сессия истекла, обновите её в настройках' });
      }
      return [];
    }
  }

  app.Auth = { getSession, setSession, getState, setState, follow, validate, prompt, clear, favorites };
})(window);
