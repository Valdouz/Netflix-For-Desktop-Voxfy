/* Netflix Ultrawide 21:9
 *
 * Most films are shot in ~2.39:1 but Netflix delivers them inside a 16:9 frame with black bars baked in.
 * On a 21:9 screen you then get bars on every side. When enabled, the picture is made to fill the video
 * box with `object-fit: cover`: cropped just enough to remove the bars, and always centred
 * (no transform, so it cannot drift to a corner whatever the player layout is).
 *
 * OFF by default. Switched on/off from the app's title bar "21:9" button (message 'nfd-ultrawide').
 */
(() => {
  let enabled = false;
  let toastTimer = 0;

  // A stylesheet with !important wins over the inline styles Netflix puts on the player.
  const style = document.createElement('style');
  style.textContent = 'video.nfd-uw { object-fit: cover !important; object-position: center center !important; }';
  (document.head || document.documentElement).appendChild(style);

  const store = chrome?.storage?.local;
  if (store) {
    store.get(['uwEnabled'], (v) => {
      if (typeof v.uwEnabled === 'boolean') enabled = v.uwEnabled;
      apply();
    });
  }

  function apply() {
    const on = enabled && location.pathname.startsWith('/watch');
    document.querySelectorAll('video').forEach((video) => video.classList.toggle('nfd-uw', on));
  }

  function toast(text) {
    let el = document.getElementById('uw-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'uw-toast';
      Object.assign(el.style, {
        position: 'fixed', top: '28px', left: '50%', transform: 'translateX(-50%)', zIndex: 2147483647,
        background: 'rgba(20,18,28,.85)', color: '#fff', font: '600 16px system-ui, sans-serif',
        padding: '10px 18px', borderRadius: '999px', border: '1px solid rgba(79,195,247,.6)',
        pointerEvents: 'none', transition: 'opacity .3s'
      });
      document.documentElement.appendChild(el);
    }
    el.textContent = text;
    el.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.style.opacity = '0'), 1400);
  }

  // Title bar button of the app
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.type !== 'nfd-ultrawide') return;
    const on = !!e.data.enabled;
    if (on !== enabled && e.data.user) toast(on ? '21:9 activé' : '21:9 désactivé');
    enabled = on;
    if (store) store.set({ uwEnabled: enabled });
    apply();
  });

  // Netflix is a single-page app: re-apply when the player appears or changes.
  document.addEventListener('loadedmetadata', apply, true);
  let pending = false;
  new MutationObserver(() => {
    if (pending) return;
    pending = true;
    setTimeout(() => { pending = false; apply(); }, 500);
  }).observe(document.documentElement, { childList: true, subtree: true });
  apply();
})();
