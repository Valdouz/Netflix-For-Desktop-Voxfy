const DEFAULTS = {
  enabled: true,
  opacity: 0.75,
  blur: 70,
  saturate: 1.6,
  fps: 10,
  shrinkFullscreen: true
};

const els = {
  toggle: document.getElementById('toggle'),
  opacity: document.getElementById('opacity'),
  blur: document.getElementById('blur'),
  saturate: document.getElementById('saturate'),
  fps: document.getElementById('fps'),
  shrinkFullscreen: document.getElementById('shrinkFullscreen')
};

function refreshLabels(s) {
  document.getElementById('v-opacity').textContent = s.opacity;
  document.getElementById('v-blur').textContent = s.blur + 'px';
  document.getElementById('v-saturate').textContent = 'x' + s.saturate;
  document.getElementById('v-fps').textContent = s.fps + ' fps';
  els.toggle.textContent = s.enabled ? 'ON' : 'OFF';
  els.toggle.classList.toggle('off', !s.enabled);
}

chrome.storage.sync.get(DEFAULTS, (s) => {
  els.opacity.value = s.opacity;
  els.blur.value = s.blur;
  els.saturate.value = s.saturate;
  els.fps.value = s.fps;
  els.shrinkFullscreen.checked = s.shrinkFullscreen;
  refreshLabels(s);
});

function save(patch) {
  chrome.storage.sync.set(patch, () => {
    chrome.storage.sync.get(DEFAULTS, refreshLabels);
  });
}

els.toggle.addEventListener('click', () => {
  chrome.storage.sync.get(DEFAULTS, (s) => {
    const enabled = !s.enabled;
    save({ enabled });
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) chrome.tabs.sendMessage(tabs[0].id, { type: 'toggle', enabled }).catch(() => {});
    });
  });
});

els.opacity.addEventListener('input', (e) => save({ opacity: parseFloat(e.target.value) }));
els.blur.addEventListener('input', (e) => save({ blur: parseInt(e.target.value, 10) }));
els.saturate.addEventListener('input', (e) => save({ saturate: parseFloat(e.target.value) }));
els.fps.addEventListener('input', (e) => save({ fps: parseInt(e.target.value, 10) }));
els.shrinkFullscreen.addEventListener('change', (e) => save({ shrinkFullscreen: e.target.checked }));

document.getElementById('test').addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id) chrome.tabs.sendMessage(tabs[0].id, { type: 'test' }).catch(() => {});
  });
});
