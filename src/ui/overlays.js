// ESC closes menu overlays. Pause ESC stays in input.js (only while playing).

export function bindOverlayEsc() {
  window.addEventListener('keydown', e => {
    if (e.code !== 'Escape') return;

    const preview = document.getElementById('previewOverlay');
    if (preview?.classList.contains('active')) {
      document.getElementById('previewBackBtn')?.click();
      e.preventDefault();
      return;
    }

    const result = document.getElementById('result');
    if (result && result.style.display === 'flex') {
      document.getElementById('resultMenuBtn')?.click();
      e.preventDefault();
      return;
    }

    if (document.querySelector('.keybind-btn.listening')) return;

    const settings = document.getElementById('settingsScreen');
    if (settings && settings.style.display === 'flex') {
      document.getElementById('settingsCloseBtn')?.click();
      e.preventDefault();
      return;
    }

    const stats = document.getElementById('statsScreen');
    if (stats && stats.style.display === 'flex') {
      document.getElementById('statsCloseBtn')?.click();
      e.preventDefault();
      return;
    }

    const cal = document.getElementById('calibrationScreen');
    if (cal && cal.style.display === 'flex') {
      document.getElementById('calibrationCloseBtn')?.click();
      e.preventDefault();
    }
  });
}
