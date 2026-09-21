(() => {
  async function fetchWarmupStatus() {
    const response = await fetch('/api/codex-warmup', { cache: 'no-store' });
    if (!response.ok) throw new Error('warmup status failed');
    return response.json();
  }

  async function syncCodexWarmup() {
    const toggle = document.getElementById('codex-warmup-toggle');
    if (!toggle) return;
    try {
      const data = await fetchWarmupStatus();
      toggle.checked = data.enabled === true;
      toggle.disabled = false;
      toggle.title = data.running ? 'Codex app-server 已預熱' : 'Codex app-server 目前未執行';
    } catch (_) {
      toggle.disabled = true;
      toggle.title = '無法讀取 Codex 預熱狀態';
    }
  }

  window.syncCodexWarmup = syncCodexWarmup;
  window.toggleCodexWarmup = async function(enabled) {
    const toggle = document.getElementById('codex-warmup-toggle');
    if (toggle) toggle.disabled = true;
    try {
      const response = await fetch('/api/codex-warmup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'warmup update failed');
      if (toggle) toggle.checked = data.enabled === true;
    } catch (_) {
      await syncCodexWarmup();
    } finally {
      if (toggle) toggle.disabled = false;
    }
  };

  document.addEventListener('DOMContentLoaded', syncCodexWarmup);
})();
