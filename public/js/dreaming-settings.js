/* Dreaming has independent model settings; never changes the active chat model. */
(() => {
  const byId = id => document.getElementById(id);
  const enabled = byId('dreaming-enabled');
  const model = byId('dreaming-model');
  const custom = byId('dreaming-custom-model');
  const effort = byId('dreaming-effort');
  const idle = byId('dreaming-idle');
  const limit = byId('dreaming-limit');
  const status = byId('dreaming-status');
  const save = byId('dreaming-save');
  if (!enabled || !model || !save) return;

  function setMessage(value, error = false) {
    status.textContent = value;
    status.classList.toggle('text-rose-400', error);
    status.classList.toggle('text-slate-400', !error);
  }

  function toggleCustom() {
    custom.classList.toggle('hidden', model.value !== '__custom__');
  }
  model.addEventListener('change', toggleCustom);

  function chooseModel(id) {
    const selected = [...model.options].find(option => option.value === id);
    if (selected) {
      model.value = id;
    } else {
      model.value = '__custom__';
      custom.value = id;
    }
    toggleCustom();
  }

  async function load() {
    try {
      const [settingsResponse, modelsResponse] = await Promise.all([
        fetch('/api/dreaming', { cache: 'no-store' }),
        fetch('/api/models', { cache: 'no-store' })
      ]);
      const settingsData = await settingsResponse.json();
      if (!settingsResponse.ok || !settingsData.success) throw new Error(settingsData.error || '無法讀取 Dreaming 設定');
      const allModels = modelsResponse.ok ? (await modelsResponse.json()).models || [] : [];
      const models = [...new Map(allModels
        .filter(item => item.provider === 'codex' && item.id)
        .map(item => [item.id, item])).values()];
      const currentModel = settingsData.settings.model;
      model.replaceChildren();
      const defaultOption = document.createElement('option');
      defaultOption.value = 'gpt-6-luna';
      defaultOption.textContent = 'GPT-6 Luna';
      model.add(defaultOption);
      for (const item of models) {
        if (item.id === 'gpt-6-luna') continue;
        const option = document.createElement('option');
        option.value = item.id;
        option.textContent = item.name || item.id;
        model.add(option);
      }
      const customOption = document.createElement('option');
      customOption.value = '__custom__';
      customOption.textContent = '自訂模型 ID…';
      model.add(customOption);
      enabled.checked = Boolean(settingsData.settings.enabled);
      effort.value = settingsData.settings.effort || 'low';
      idle.value = String(settingsData.settings.idleMinutes || 15);
      limit.value = String(settingsData.settings.dailyLimit ?? 1);
      chooseModel(currentModel);
      const pending = Object.values(settingsData.roles || {}).reduce((sum, entry) => sum + (entry.pending || 0), 0);
      setMessage('待整理事件：' + pending + ' · 僅有新資料且閒置達標時才消耗額度');
    } catch (error) {
      setMessage(error.message || '設定讀取失敗', true);
    }
  }

  save.addEventListener('click', async () => {
    const selected = model.value === '__custom__' ? custom.value.trim() : model.value;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,119}$/.test(selected)) {
      return setMessage('請輸入有效的 Codex 模型 ID', true);
    }
    save.disabled = true;
    try {
      const response = await fetch('/api/dreaming', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: enabled.checked,
          model: selected,
          effort: effort.value,
          idleMinutes: Number(idle.value),
          dailyLimit: Number(limit.value)
        })
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || '設定儲存失敗');
      setMessage('已儲存 · ' + selected + ' / ' + effort.value + ' · 不影響目前角色模型');
    } catch (error) {
      setMessage(error.message || '設定儲存失敗', true);
    } finally {
      save.disabled = false;
    }
  });

  load();
})();
