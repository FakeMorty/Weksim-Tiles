// Etap i18n: language picker in the menu.
// Populates the <select id="languageSelect"> with all available locales and
// wires up switching. On change, re-applies data-i18n across the DOM and
// notifies all subscribers (menu.js, judge.js, etc.).

import { LOCALES, getLocale, setLocale, applyTranslations, onLocaleChange } from '../i18n/i18n.js';

export function bindLanguagePicker() {
  const sel = document.getElementById('languageSelect');
  if (!sel) return;

  // Populate options. Show native names — a Chinese user sees "中文", not "Chinese".
  sel.innerHTML = '';
  for (const loc of LOCALES) {
    const opt = document.createElement('option');
    opt.value = loc.code;
    opt.textContent = loc.nativeLabel;
    sel.appendChild(opt);
  }
  sel.value = getLocale();

  sel.addEventListener('change', () => {
    setLocale(sel.value);
    // setLocale already updated <html lang>+<html dir> and fired listeners.
    // We just need to re-run the DOM sweep for data-i18n elements.
    applyTranslations();
  });

  // Anyone else subscribed via onLocaleChange (menu.js subtitle, etc.) also
  // needs applyTranslations to happen — hook it up as a global reaction so
  // that any programmatic setLocale() call refreshes the DOM too.
  onLocaleChange(() => applyTranslations());
}
