/* Crew Pocket appearance: dark by default, optional light/system mode. */
(() => {
  'use strict';
  const STORAGE_KEY = 'crew_theme';
  const ALLOWED = ['dark', 'light', 'system'];
  const root = document.documentElement;
  const media = typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  let preference = 'dark';
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (ALLOWED.includes(saved)) preference = saved;
  } catch (_) { /* WebView storage can be unavailable. */ }

  const resolvedTheme = () =>
    preference === 'system' ? (media && !media.matches ? 'light' : 'dark') : preference;

  function applyTheme() {
    const mode = resolvedTheme();
    root.dataset.crewTheme = mode;
    root.classList.toggle('dark', mode === 'dark');
    root.style.colorScheme = mode;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', mode === 'dark' ? '#0B1020' : '#F5F7FB');
    document.querySelectorAll('[data-theme-choice]').forEach(button => {
      const active = button.dataset.themeChoice === preference;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function setPreference(nextPreference) {
    if (!ALLOWED.includes(nextPreference)) return;
    preference = nextPreference;
    try { window.localStorage.setItem(STORAGE_KEY, preference); } catch (_) {}
    applyTheme();
    document.dispatchEvent(new CustomEvent('crew:themechange', {
      detail: { preference, theme: resolvedTheme() }
    }));
  }

  function attachControls() {
    document.querySelectorAll('[data-theme-choice]').forEach(button => {
      button.addEventListener('click', () => setPreference(button.dataset.themeChoice));
    });
    applyTheme();
  }

  if (media) {
    const onChange = () => { if (preference === 'system') applyTheme(); };
    if (typeof media.addEventListener === 'function') media.addEventListener('change', onChange);
    else if (typeof media.addListener === 'function') media.addListener(onChange);
  }

  window.CrewTheme = {
    getPreference: () => preference,
    getResolvedTheme: resolvedTheme,
    setPreference
  };
  applyTheme(); // Run in the head to prevent a light-theme flash.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachControls, { once: true });
  } else {
    attachControls();
  }
})();
