export const THEME_STORAGE_KEY = 'zis-solar-theme';

// Apply the preference before the first paint so a dark page does not flash white.
export const themeBootstrap = `(() => {
  let preference;
  try { preference = localStorage.getItem('${THEME_STORAGE_KEY}'); } catch {}
  const dark = preference === 'dark' || (preference !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
})();`;
