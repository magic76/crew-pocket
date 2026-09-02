/**
 * Screen Keep Awake / WakeLock Manager for Crew Pocket
 * Prevents screen timeout / sleep when user enables Keep Awake.
 */

let wakeLockSentinel = null;
let isKeepAwakeEnabled = localStorage.getItem('crew_pocket_keep_awake') === 'true';

const wakeLockBtn = document.getElementById('wake-lock-btn');
const menuWakeLockBtn = document.getElementById('menu-wake-lock-btn');
const wakeLockMenuIcon = document.getElementById('wake-lock-menu-icon');
const wakeLockStatusTitle = document.getElementById('wake-lock-status-title');
const wakeLockStatusSubtext = document.getElementById('wake-lock-status-subtext');

async function requestScreenWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      wakeLockSentinel = await navigator.wakeLock.request('screen');
      wakeLockSentinel.addEventListener('release', () => {
        wakeLockSentinel = null;
        if (isKeepAwakeEnabled && document.visibilityState === 'visible') {
          // Re-acquire if release was unexpected
          requestScreenWakeLock();
        }
      });
    } catch (err) {
      console.warn('Wake Lock request error:', err);
    }
  }

  // Also sync with native helper if available
  try {
    fetch('/api/phone/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'KEEP_AWAKE', enabled: true })
    }).catch(() => {});
  } catch (ignored) {}
}

async function releaseScreenWakeLock() {
  if (wakeLockSentinel) {
    try {
      await wakeLockSentinel.release();
    } catch (err) {
      console.warn('Wake Lock release error:', err);
    }
    wakeLockSentinel = null;
  }

  // Also sync with native helper if available
  try {
    fetch('/api/phone/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'KEEP_AWAKE', enabled: false })
    }).catch(() => {});
  } catch (ignored) {}
}

function updateWakeLockUI() {
  if (wakeLockBtn) {
    if (isKeepAwakeEnabled) {
      wakeLockBtn.classList.remove('text-slate-400', 'bg-slate-900/90', 'border-slate-700/80');
      wakeLockBtn.classList.add('text-amber-300', 'bg-amber-500/25', 'border-amber-500/70', 'shadow-[0_0_10px_rgba(245,158,11,0.35)]');
      wakeLockBtn.title = '螢幕常亮：已開啟 (防止休眠中)';
    } else {
      wakeLockBtn.classList.remove('text-amber-300', 'bg-amber-500/25', 'border-amber-500/70', 'shadow-[0_0_10px_rgba(245,158,11,0.35)]');
      wakeLockBtn.classList.add('text-slate-400', 'bg-slate-900/90', 'border-slate-700/80');
      wakeLockBtn.title = '螢幕常亮：已關閉 (點擊開啟防止休眠)';
    }
  }

  if (menuWakeLockBtn) {
    if (isKeepAwakeEnabled) {
      if (wakeLockMenuIcon) {
        wakeLockMenuIcon.className = 'w-6 h-6 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-300 group-hover:scale-105 transition shrink-0';
      }
      if (wakeLockStatusTitle) wakeLockStatusTitle.textContent = '螢幕常亮 (已開啟)';
      if (wakeLockStatusSubtext) {
        wakeLockStatusSubtext.textContent = '防止螢幕休眠中 (常亮啟用)';
        wakeLockStatusSubtext.className = 'text-[10px] text-amber-400/90 font-medium';
      }
      menuWakeLockBtn.title = '切換螢幕常亮 (目前已開啟)';
    } else {
      if (wakeLockMenuIcon) {
        wakeLockMenuIcon.className = 'w-6 h-6 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-slate-400 group-hover:scale-105 transition shrink-0';
      }
      if (wakeLockStatusTitle) wakeLockStatusTitle.textContent = '螢幕常亮';
      if (wakeLockStatusSubtext) {
        wakeLockStatusSubtext.textContent = '點擊開啟防止螢幕休眠';
        wakeLockStatusSubtext.className = 'text-[10px] text-slate-400';
      }
      menuWakeLockBtn.title = '切換螢幕常亮 (目前已關閉)';
    }
  }
}

export async function toggleScreenKeepAwake() {
  isKeepAwakeEnabled = !isKeepAwakeEnabled;
  localStorage.setItem('crew_pocket_keep_awake', isKeepAwakeEnabled);

  if (isKeepAwakeEnabled) {
    await requestScreenWakeLock();
    if (typeof window.showToast === 'function') {
      window.showToast('☀️ 螢幕常亮已開啟（防止休眠）', 'success');
    }
  } else {
    await releaseScreenWakeLock();
    if (typeof window.showToast === 'function') {
      window.showToast('🌙 螢幕常亮已關閉', 'info');
    }
  }

  updateWakeLockUI();
  return isKeepAwakeEnabled;
}

export function initScreenKeepAwake() {
  updateWakeLockUI();

  if (isKeepAwakeEnabled) {
    requestScreenWakeLock();
  }

  if (wakeLockBtn) {
    wakeLockBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleScreenKeepAwake();
    });
  }

  if (menuWakeLockBtn) {
    menuWakeLockBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleScreenKeepAwake();
    });
  }

  document.addEventListener('visibilitychange', async () => {
    if (isKeepAwakeEnabled && document.visibilityState === 'visible') {
      await requestScreenWakeLock();
    }
  });
}

// Auto init on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initScreenKeepAwake);
} else {
  initScreenKeepAwake();
}
