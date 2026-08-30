// In-app notice strip — replaces window.alert for non-blocking feedback.

let hideTimer = 0;

export function notice(msg, ms = 2800) {
  const el = document.getElementById('noticeBar');
  if (!el) return;
  el.textContent = String(msg ?? '');
  el.classList.add('show');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => el.classList.remove('show'), ms);
}
