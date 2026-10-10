// Server-owned opt-in flag; default is always OFF, never localStorage.
(() => {
  const toggle = document.getElementById('auto-compact-enabled');
  const status = document.getElementById('auto-compact-settings-status');
  if (!toggle || !status) return;

  async function load() {
    try {
      const response = await fetch('/api/context/auto-compact-settings', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || '設定讀取失敗');
      toggle.checked = data.enabled === true;
      status.textContent = toggle.checked ? '已開啟 · 僅在角色完全閒置且通過冷卻與安全檢查時執行' : '預設關閉 · Context 達建議門檻時仍可手動精簡';
    } catch (error) {
      toggle.checked = false;
      status.textContent = error.message || '設定讀取失敗';
    }
  }

  toggle.addEventListener('change', async () => {
    toggle.disabled = true;
    const requested = toggle.checked;
    try {
      const response = await fetch('/api/context/auto-compact-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: requested })
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || '設定儲存失敗');
      status.textContent = data.enabled
        ? '已開啟 · 只在安全空檔自動整理目前符合條件的工作 Context'
        : '已關閉 · 保留手動 Safe Compact';
    } catch (error) {
      toggle.checked = !requested;
      status.textContent = error.message || '設定儲存失敗';
    } finally {
      toggle.disabled = false;
    }
  });
  load();
})();
