/* Netflix Ultrawide 21:9
 *
 * Most films are shot in ~2.39:1 but Netflix delivers them inside a 16:9 frame with black bars baked in.
 * On a 21:9 screen you get bars on every side. This script scales the <video> so the picture fills the
 * window width (crop mode), like the "21:9" button of popular extensions.
 *
 * Shortcuts (on the player): Z = toggle zoom, Shift+Z = cycle zoom presets.
 */
(() => {
  const PRESETS = [
    { name: 'Auto (fill width)', factor: null },
    { name: '21:9 (2.37:1)', factor: 2.37 / (16 / 9) },
    { name: '2.39:1 cinemascope', factor: 2.39 / (16 / 9) },
    { name: '2:1 (Univisium)', factor: 2.0 / (16 / 9) }
  ];
  let state = { enabled: true, preset: 0 };
  let toastTimer = 0;

  const store = chrome?.storage?.local;
  if (store) {
    store.get(['uwEnabled', 'uwPreset'], (v) => {
      if (typeof v.uwEnabled === 'boolean') state.enabled = v.uwEnabled;
      if (Number.isInteger(v.uwPreset)) state.preset = v.uwPreset % PRESETS.length;
      apply();
    });
  }
  const save = () => store && store.set({ uwEnabled: state.enabled, uwPreset: state.preset });

  function factor(video) {
    const p = PRESETS[state.preset];
    if (p.factor) return p.factor;
    // Auto: scale so a 16:9 frame fills the window width, never more than the window's own ratio allows.
    const winRatio = window.innerWidth / window.innerHeight;
    const vidRatio = (video.videoWidth && video.videoHeight) ? video.videoWidth / video.videoHeight : 16 / 9;
    return Math.max(1, winRatio / vidRatio);
  }

  function apply() {
    const video = document.querySelector('video');
    if (!video) return;
    const onWatch = location.pathname.startsWith('/watch');
    const ultrawide = window.innerWidth / window.innerHeight > 2.0;
    if (state.enabled && onWatch && ultrawide) {
      const f = factor(video);
      video.style.transform = `scale(${f.toFixed(4)})`;
      video.style.transformOrigin = 'center center';
      video.style.transition = 'transform .25s ease';
    } else {
      video.style.transform = '';
    }
  }

  function toast(text) {
    let el = document.getElementById('uw-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'uw-toast';
      Object.assign(el.style, {
        position: 'fixed', top: '28px', left: '50%', transform: 'translateX(-50%)', zIndex: 2147483647,
        background: 'rgba(20,18,28,.85)', color: '#fff', font: '600 16px system-ui, sans-serif',
        padding: '10px 18px', borderRadius: '999px', border: '1px solid rgba(255,122,168,.6)',
        pointerEvents: 'none', transition: 'opacity .3s'
      });
      document.documentElement.appendChild(el);
    }
    el.textContent = text;
    el.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.style.opacity = '0'), 1400);
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'z' && e.key !== 'Z') return;
    if (e.target && /input|textarea/i.test(e.target.tagName)) return;
    if (e.shiftKey) {
      state.preset = (state.preset + 1) % PRESETS.length;
      state.enabled = true;
      toast(`Ultrawide : ${PRESETS[state.preset].name}`);
    } else {
      state.enabled = !state.enabled;
      toast(state.enabled ? `Ultrawide activé · ${PRESETS[state.preset].name}` : 'Ultrawide désactivé');
    }
    save();
    apply();
  }, true);

  // Netflix is a single-page app: re-apply when the player or the window changes.
  window.addEventListener('resize', apply);
  document.addEventListener('loadedmetadata', apply, true);
  let pending = false;
  new MutationObserver(() => {
    if (pending) return;
    pending = true;
    setTimeout(() => { pending = false; apply(); }, 500);
  }).observe(document.documentElement, { childList: true, subtree: true });
  apply();
})();
