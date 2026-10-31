/* Run in <head> before paint so the saved theme also covers the loading screen. */
(function setupTheme() {
  'use strict';
  const key = 'saa-c03-theme';
  const root = document.documentElement;
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  const valid = value => ['system', 'light', 'dark'].includes(value);
  let preference = valid(root.dataset.themePreference) ? root.dataset.themePreference : 'system';
  try { const stored = localStorage.getItem(key); if (valid(stored)) preference = stored; } catch {}
  let control, button, menu;
  const labels = { system: '시스템 설정', light: '라이트', dark: '다크' };
  const paths = {
    system: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/>',
    light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
    dark: '<path d="M20 14.4A8.5 8.5 0 0 1 9.6 4a8.5 8.5 0 1 0 10.4 10.4Z"/>',
    check: '<path d="m5 12 4 4L19 6"/>'
  };
  const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;

  function apply() {
    const theme = preference === 'system' ? (system.matches ? 'dark' : 'light') : preference;
    root.dataset.theme = theme;
    root.dataset.themePreference = preference;
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) { meta = document.createElement('meta'); meta.name = 'theme-color'; document.head.append(meta); }
    meta.content = theme === 'dark' ? '#101722' : '#182b44';
    if (!button) return;
    button.innerHTML = icon(preference === 'system' ? 'system' : theme);
    button.setAttribute('aria-label', `테마 설정: ${labels[preference]}${preference === 'system' ? ` (${labels[theme]})` : ''}`);
    button.title = '테마 설정';
    for (const item of menu.children) item.setAttribute('aria-checked', String(item.dataset.themeChoice === preference));
  }

  function close(restoreFocus = false) {
    if (!menu || menu.hidden) return;
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (restoreFocus) button.focus({ preventScroll: true });
  }

  function open() {
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    menu.querySelector('[aria-checked="true"]').focus();
  }

  function mount() {
    // The wiki replaces its header when navigating between bundled documents.
    const target = document.querySelector('.site-header .primary-nav, .top .top-actions, .theme-home');
    if (target && !target.contains(control)) { close(); target.append(control); }
  }

  function initialize() {
    if (document.body.dataset.page === 'home' && !document.querySelector('.theme-home')) {
      const home = document.createElement('div'); home.className = 'theme-home';
      document.body.prepend(home);
    }
    control = document.createElement('div'); control.className = 'theme-control'; control.dataset.themeUi = '';
    button = document.createElement('button'); button.type = 'button'; button.className = 'theme-toggle';
    button.setAttribute('aria-haspopup', 'menu'); button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', 'theme-menu');
    menu = document.createElement('div'); menu.id = 'theme-menu'; menu.className = 'theme-menu'; menu.hidden = true;
    menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', '화면 테마');
    for (const choice of ['system', 'light', 'dark']) {
      const item = document.createElement('button'); item.type = 'button'; item.tabIndex = -1;
      item.dataset.themeChoice = choice; item.setAttribute('role', 'menuitemradio');
      item.innerHTML = `${icon(choice)}<span>${labels[choice]}</span><span class="theme-check">${icon('check')}</span>`;
      item.addEventListener('click', () => {
        preference = choice;
        try { localStorage.setItem(key, preference); } catch {}
        apply(); close(true);
      });
      menu.append(item);
    }
    control.append(button, menu); apply(); mount();
    button.addEventListener('click', () => menu.hidden ? open() : close());
    control.addEventListener('keydown', event => {
      if (event.key === 'Escape') { if (!menu.hidden) { event.preventDefault(); event.stopPropagation(); close(true); } return; }
      if (event.key === 'Tab') { close(true); return; }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      if (menu.hidden) { open(); return; }
      const items = [...menu.children], index = items.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next].focus();
    });
    control.addEventListener('focusout', event => { if (!control.contains(event.relatedTarget)) close(); });
    document.addEventListener('click', event => { if (!control.contains(event.target)) close(); });
    window.addEventListener('hashchange', () => close());
    const header = document.querySelector('.site-header');
    if (header) new MutationObserver(mount).observe(header, { childList: true, subtree: true });
  }

  system.addEventListener('change', () => { if (preference === 'system') apply(); });
  window.addEventListener('storage', event => {
    if (event.key !== key && event.key !== null) return;
    preference = valid(event.newValue) ? event.newValue : 'system';
    apply();
  });
  apply();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();

  // Keep the existing one-file progress backup usable offline, including themes.
  window.SaaTheme = {
    prepareExport(snapshot) {
      const sheet = [...document.styleSheets].find(item => item.ownerNode?.hasAttribute('data-theme-assets'));
      if (!sheet) throw new Error('Theme stylesheet is not ready.');
      const style = document.createElement('style'); style.dataset.themeAssets = '';
      style.textContent = [...sheet.cssRules].map(rule => rule.cssText).join('\n');
      const script = document.createElement('script'); script.dataset.themeAssets = '';
      script.textContent = `(${setupTheme.toString()})();`;
      for (const element of snapshot.querySelectorAll('[data-theme-assets], [data-theme-ui]')) element.remove();
      snapshot.querySelector('head').append(style, script);
    }
  };
})();
