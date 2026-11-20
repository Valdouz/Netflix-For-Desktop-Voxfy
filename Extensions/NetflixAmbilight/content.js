/* Netflix Ambilight — content script (MVP)
 *
 * Principe (identique à "Ambient light for YouTube") :
 *  - on capture la <video> Netflix vers un micro-canvas (ex: 32x18) à ~10 fps
 *  - on recopie ce micro-canvas vers un grand canvas plein écran flouté en CSS
 *  - le grand canvas est derrière la vidéo => halo ambiant
 *
 * Note DRM : avec l'accélération matérielle activée, Widevine rend la vidéo
 * via l'overlay GPU et drawImage() renvoie du noir. Sans accélération
 * matérielle (ton cas), les pixels sont lisibles et ça fonctionne.
 */

(() => {
  console.log('[Netflix Ambilight] content-script chargé v0.1.4 sur', location.href);
  const SMALL_W = 32;
  const SMALL_H = 18;

  const DEFAULTS = {
    enabled: true,
    opacity: 0.75,      // 0..1
    blur: 70,           // px
    saturate: 1.6,      // 0..3
    fps: 10,            // 5..30 (bas = moins de CPU, important sans GPU)
    shrinkFullscreen: true,
    smoothing: 0.6      // 0..0.95 lissage anti-scintillement
  };

  let settings = { ...DEFAULTS };
  let video = null;
  let bgCanvas = null;
  let smallCanvas = null;
  let smallCtx = null;
  let bgCtx = null;
  let rafId = 0;
  let lastTime = 0;
  let prevData = null;
  let blackFrames = 0;
  let observer = null;

  // ---------- settings ----------
  chrome.storage.sync.get(DEFAULTS, (res) => {
    settings = { ...DEFAULTS, ...res };
    applyStyle();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const k of Object.keys(changes)) settings[k] = changes[k].newValue;
    applyStyle();
  });

  function applyStyle() {
    document.documentElement.classList.toggle('nflx-amb-on', !!settings.enabled);
    if (!bgCanvas) return;
    bgCanvas.style.opacity = String(settings.opacity);
    bgCanvas.style.filter = `blur(${settings.blur}px) saturate(${settings.saturate})`;
    bgCanvas.style.display = settings.enabled ? 'block' : 'none';
    if (video) {
      const fs = document.fullscreenElement;
      video.classList.toggle(
        'nflx-amb-shrink',
        !!settings.shrinkFullscreen && !!fs && !!settings.enabled
      );
    }
  }

  // ---------- setup ----------
  function findVideo() {
    const vids = Array.from(document.querySelectorAll('video'));
    // Prend la plus grande (la vidéo principale, pas les aperçus)
    vids.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight);
    return vids[0] || null;
  }

  function ensureCanvases() {
    if (!bgCanvas) {
      bgCanvas = document.createElement('canvas');
      bgCanvas.id = 'nflx-amb-bg';
      bgCanvas.width = 256;
      bgCanvas.height = 144;
      // Insère derrière : en premier dans le fullscreen element si présent, sinon body
      const host = document.fullscreenElement || document.body;
      host.insertBefore(bgCanvas, host.firstChild);
      bgCtx = bgCanvas.getContext('2d');
      applyStyle();
    }
    if (!smallCanvas) {
      smallCanvas = document.createElement('canvas');
      smallCanvas.width = SMALL_W;
      smallCanvas.height = SMALL_H;
      smallCtx = smallCanvas.getContext('2d', { willReadFrequently: true });
    }
    // Si on passe en fullscreen, déplace le canvas dans l'élément fullscreen
    // sinon il est caché derrière.
    const host = document.fullscreenElement || document.body;
    if (bgCanvas.parentNode !== host) {
      host.insertBefore(bgCanvas, host.firstChild);
    }
  }

  function attachToVideo(v) {
    if (v === video) return;
    video = v;
    video.classList.add('nflx-amb-video');
    console.log(
      '[Netflix Ambilight] vidéo accrochée :',
      v.clientWidth + 'x' + v.clientHeight,
      'videoWidth=' + v.videoWidth,
      'paused=' + v.paused
    );
    // Redessine quand la vidéo change d'état (y compris en pause pour le test)
    // Un seek/play relance aussi une tentative après un blocage DRM.
    const retry = () => {
      blackFrames = 0;
      prevData = null;
      window.__nflxAmbBlocked = false;
      lastTime = 0;
      startLoop();
    };
    v.addEventListener('play', retry);
    v.addEventListener('seeked', retry);
    v.addEventListener('loadeddata', retry);
    ensureCanvases();
    startLoop();
  }

  // ---------- render loop ----------
  function sample(now) {
    rafId = 0;
    if (!video || !settings.enabled) return;

    const interval = 1000 / Math.max(1, settings.fps);
    if (now - lastTime < interval) {
      rafId = requestAnimationFrame(sample);
      return;
    }
    lastTime = now;

    try {
      // On dessine même en pause (image fixe) pour que le halo soit visible
      // dès le chargement. Seule condition : des dimensions vidéo connues.
      if (video.videoWidth === 0 || video.readyState < 2) {
        rafId = requestAnimationFrame(sample);
        return;
      }
      smallCtx.drawImage(video, 0, 0, SMALL_W, SMALL_H);

      const frame = smallCtx.getImageData(0, 0, SMALL_W, SMALL_H);

      // Détection DRM : frames noires en continu => drawImage bloqué
      let sum = 0;
      const d = frame.data;
      for (let i = 0; i < d.length; i += 16) sum += d[i] + d[i + 1] + d[i + 2];
      if (sum < 200) {
        blackFrames++;
        if (blackFrames === 10) {
          console.warn(
            '[Netflix Ambilight] capture noire (' + blackFrames + ' frames) : ' +
            'la DRM bloque probablement drawImage sur ce setup.'
          );
        }
        // Coupe la boucle si la capture reste noire : inutile de brûler du CPU.
        // Un seek/play relancera une tentative (listeners dans attachToVideo).
        if (blackFrames >= 150) {
          if (!window.__nflxAmbBlocked) {
            window.__nflxAmbBlocked = true;
            console.warn(
              '[Netflix Ambilight] capture toujours noire après 150 frames : boucle stoppée.'
            );
          }
          stopLoop();
          return;
        }
      } else {
        if (blackFrames > 0) console.log('[Netflix Ambilight] capture OK, pixels reçus.');
        blackFrames = 0;
        if (!window.__nflxAmbDrew) {
          window.__nflxAmbDrew = true;
          console.log('[Netflix Ambilight] premier dessin OK, halo actif.');
        }
      }

      // Lissage temporel anti-scintillement
      if (prevData && settings.smoothing > 0) {
        const s = settings.smoothing;
        for (let i = 0; i < d.length; i++) {
          d[i] = d[i] * (1 - s) + prevData[i] * s;
        }
        smallCtx.putImageData(frame, 0, 0);
      } else {
        prevData = new Uint8ClampedArray(d);
      }
      if (!prevData || prevData.length !== d.length) {
        prevData = new Uint8ClampedArray(d);
      } else {
        prevData.set(d);
      }

      // Recopie vers le grand canvas (le blur CSS fait le reste)
      bgCtx.imageSmoothingEnabled = true;
      bgCtx.drawImage(smallCanvas, 0, 0, bgCanvas.width, bgCanvas.height);
    } catch (e) {
      // Canvas "tainted" (CORS/DRM) : on arrête proprement
      console.warn('[Netflix Ambilight] capture impossible :', e);
      stopLoop();
      return;
    }
    rafId = requestAnimationFrame(sample);
  }

  function startLoop() {
    ensureCanvases();
    applyStyle();
    if (!rafId && settings.enabled) {
      lastTime = 0;
      // Préfère requestVideoFrameCallback (moins de CPU) si dispo
      if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
        const onFrame = () => {
          if (!video || !settings.enabled) return;
          if (!rafId) rafId = requestAnimationFrame(sample);
          try { video.requestVideoFrameCallback(onFrame); } catch { /* noop */ }
        };
        try { video.requestVideoFrameCallback(onFrame); } catch { /* noop */ }
      }
      rafId = requestAnimationFrame(sample);
    }
  }

  function stopLoop() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  // ---------- observe SPA Netflix ----------
  function watch() {
    const v = findVideo();
    if (v && (v.clientWidth > 200 || v.videoWidth > 0)) attachToVideo(v);

    if (!observer) {
      observer = new MutationObserver(() => {
        const cand = findVideo();
        if (cand && cand !== video) attachToVideo(cand);
        ensureCanvases();
        applyStyle();
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  document.addEventListener('fullscreenchange', () => {
    ensureCanvases();
    applyStyle();
  });

  // Message du popup : on/off immédiat
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'test') {
      try {
        ensureCanvases();
        bgCtx.fillStyle = '#f00';
        bgCtx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);
        bgCanvas.style.display = 'block';
        bgCanvas.style.opacity = '0.8';
        console.log('[Netflix Ambilight] test rouge affiché.');
      } catch (e) {
        console.warn('[Netflix Ambilight] test impossible :', e);
      }
      return;
    }    if (msg.type === 'toggle' && video) {
      settings.enabled = msg.enabled;
      if (settings.enabled) startLoop();
      else {
        stopLoop();
        if (bgCanvas) bgCanvas.style.display = 'none';
        video.classList.remove('nflx-amb-shrink');
      }
    }
  });

  watch();
  setInterval(watch, 3000); // filet de sécurité SPA

  // Crée le canvas immédiatement (même sans <video>) pour vérifier l'injection.
  // Expose un handle debug : window.__nflxAmb
  try {
    ensureCanvases();
    applyStyle();
  } catch (e) {
    console.warn('[Netflix Ambilight] init canvas impossible :', e);
  }
  window.__nflxAmb = {
    version: '0.1.4',
    get video() { return video; },
    get bgCanvas() { return bgCanvas; },
    ensureCanvases,
    applyStyle,
    get settings() { return settings; },
    // Test visuel : remplit le halo en rouge. Si tu vois du rouge autour
    // de la vidéo, le positionnement/CSS est OK et c'est la capture qui bloque.
    test() {
      ensureCanvases();
      bgCtx.fillStyle = '#f00';
      bgCtx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);
      bgCanvas.style.display = 'block';
      bgCanvas.style.opacity = '0.8';
      console.log('[Netflix Ambilight] test rouge affiché.');
    },
    status() {
      return {
        video: !!video,
        videoSize: video ? video.clientWidth + 'x' + video.clientHeight : null,
        videoWidth: video ? video.videoWidth : null,
        paused: video ? video.paused : null,
        canvas: !!bgCanvas,
        canvasInDOM: !!document.getElementById('nflx-amb-bg'),
        htmlClass: document.documentElement.classList.contains('nflx-amb-on'),
        blackFrames,
        settings
      };
    }
  };
})();

/* Netflix-For-Desktop: WebView2 does not show extension popups, so the app's title bar
 * "Ambilight" button turns the glow on/off by posting a message to the page. */
window.addEventListener('message', (e) => {
  if (e.source !== window || !e.data || e.data.type !== 'nfd-ambilight') return;
  chrome.storage.sync.set({ enabled: !!e.data.enabled });
});