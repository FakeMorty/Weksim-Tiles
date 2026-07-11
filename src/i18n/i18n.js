// i18n core: translation lookup with fallback + interpolation.
//
// Usage:
//   import { t, setLocale, getLocale, LOCALES } from './i18n/i18n.js';
//   t('menu.play')                    -> "Играть" (or current locale)
//   t('menu.notes_count', {n: 42})    -> "42 нот" with substitution
//
// All translations are shipped statically as ES modules. Bundler-less, works
// offline, no HTTP requests. Adding a language = one new file in locales/.

import { en } from './locales/en.js';
import { ru } from './locales/ru.js';
import { de } from './locales/de.js';
import { fr } from './locales/fr.js';
import { es } from './locales/es.js';
import { pl } from './locales/pl.js';
import { zh } from './locales/zh.js';
import { ja } from './locales/ja.js';
import { ko } from './locales/ko.js';
import { ar } from './locales/ar.js';
import { hi } from './locales/hi.js';
import { pt } from './locales/pt.js';
import { id } from './locales/id.js';
import { tr } from './locales/tr.js';
import { vi } from './locales/vi.js';
import { it } from './locales/it.js';
import { bn } from './locales/bn.js';
import { ur } from './locales/ur.js';
import { fa } from './locales/fa.js';
import { uk } from './locales/uk.js';
import { ta } from './locales/ta.js';
import { te } from './locales/te.js';
import { th } from './locales/th.js';
import { he } from './locales/he.js';
import { el } from './locales/el.js';
import { cs } from './locales/cs.js';

// Registry — key = BCP-47 tag, value = translation object.
const TABLES = {
  en, ru, de, fr, es, pl, zh, ja, ko, ar, hi,
  pt, id, tr, vi, it, bn, ur, fa, uk, ta, te, th, he, el, cs,
};

// Human-facing labels shown in the language picker (in the language itself).
// Sorted roughly by native-speaker count so most-used surface first.
export const LOCALES = [
  { code: 'en', label: 'English',     nativeLabel: 'English',    dir: 'ltr' },
  { code: 'zh', label: 'Chinese',     nativeLabel: '中文',        dir: 'ltr' },
  { code: 'hi', label: 'Hindi',       nativeLabel: 'हिन्दी',      dir: 'ltr' },
  { code: 'es', label: 'Spanish',     nativeLabel: 'Español',    dir: 'ltr' },
  { code: 'ar', label: 'Arabic',      nativeLabel: 'العربية',    dir: 'rtl' },
  { code: 'bn', label: 'Bengali',     nativeLabel: 'বাংলা',       dir: 'ltr' },
  { code: 'pt', label: 'Portuguese',  nativeLabel: 'Português',  dir: 'ltr' },
  { code: 'ru', label: 'Russian',     nativeLabel: 'Русский',    dir: 'ltr' },
  { code: 'ja', label: 'Japanese',    nativeLabel: '日本語',      dir: 'ltr' },
  { code: 'de', label: 'German',      nativeLabel: 'Deutsch',    dir: 'ltr' },
  { code: 'ur', label: 'Urdu',        nativeLabel: 'اردو',       dir: 'rtl' },
  { code: 'id', label: 'Indonesian',  nativeLabel: 'Bahasa Indonesia', dir: 'ltr' },
  { code: 'fr', label: 'French',      nativeLabel: 'Français',   dir: 'ltr' },
  { code: 'tr', label: 'Turkish',     nativeLabel: 'Türkçe',     dir: 'ltr' },
  { code: 'vi', label: 'Vietnamese',  nativeLabel: 'Tiếng Việt', dir: 'ltr' },
  { code: 'ko', label: 'Korean',      nativeLabel: '한국어',      dir: 'ltr' },
  { code: 'it', label: 'Italian',     nativeLabel: 'Italiano',   dir: 'ltr' },
  { code: 'ta', label: 'Tamil',       nativeLabel: 'தமிழ்',      dir: 'ltr' },
  { code: 'te', label: 'Telugu',      nativeLabel: 'తెలుగు',     dir: 'ltr' },
  { code: 'fa', label: 'Persian',     nativeLabel: 'فارسی',      dir: 'rtl' },
  { code: 'pl', label: 'Polish',      nativeLabel: 'Polski',     dir: 'ltr' },
  { code: 'uk', label: 'Ukrainian',   nativeLabel: 'Українська', dir: 'ltr' },
  { code: 'th', label: 'Thai',        nativeLabel: 'ไทย',        dir: 'ltr' },
  { code: 'el', label: 'Greek',       nativeLabel: 'Ελληνικά',   dir: 'ltr' },
  { code: 'cs', label: 'Czech',       nativeLabel: 'Čeština',    dir: 'ltr' },
  { code: 'he', label: 'Hebrew',      nativeLabel: 'עברית',       dir: 'rtl' },
];

const LS_KEY = 'wt.locale.v1';
let currentLocale = 'en';
const listeners = new Set();

/**
 * Detect a sensible starting locale from browser preferences. Called once
 * on first load if user hasn't picked one yet.
 */
function detectLocale() {
  const nav = (typeof navigator !== 'undefined' && navigator.languages) || ['en'];
  for (const raw of nav) {
    const short = raw.toLowerCase().split('-')[0];
    if (TABLES[short]) return short;
  }
  return 'en';
}

/**
 * Read the persisted locale (or auto-detect on first run).
 */
export function loadLocale() {
  try {
    const saved = localStorage.getItem(LS_KEY);
    if (saved && TABLES[saved]) {
      currentLocale = saved;
      return;
    }
  } catch {}
  currentLocale = detectLocale();
}

export function getLocale() { return currentLocale; }

export function getLocaleDir() {
  const meta = LOCALES.find(l => l.code === currentLocale);
  return meta?.dir || 'ltr';
}

/**
 * Change the active locale, persist, apply <html lang>+<html dir>, notify
 * listeners so they can re-render.
 */
export function setLocale(code) {
  if (!TABLES[code]) return;
  currentLocale = code;
  try { localStorage.setItem(LS_KEY, code); } catch {}
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.lang = code;
    document.documentElement.dir = getLocaleDir();
  }
  for (const fn of listeners) {
    try { fn(code); } catch (e) { console.error('locale listener failed:', e); }
  }
}

/**
 * Subscribe to locale changes. Returns unsubscribe fn.
 * Modules that render translated strings should register here and re-run
 * their DOM updates when notified.
 */
export function onLocaleChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * The main translation function.
 * @param {string} key           dot-path into the translation tree, e.g. "menu.play"
 * @param {object} [vars]        interpolation vars, referenced as {name} in the string
 * @returns {string}             translated string, or the key itself if not found
 */
export function t(key, vars) {
  const table = TABLES[currentLocale] || TABLES.en;
  let val = lookup(table, key);
  if (val == null) {
    // Fallback to English before giving up
    val = lookup(TABLES.en, key);
  }
  if (val == null) return key; // last-resort — return the key, visible in UI = missing translation
  if (vars) return interpolate(String(val), vars);
  return String(val);
}

function lookup(obj, key) {
  const parts = key.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in cur) cur = cur[p];
    else return null;
  }
  return cur;
}

function interpolate(str, vars) {
  return str.replace(/\{(\w+)\}/g, (_, name) =>
    name in vars ? String(vars[name]) : '{' + name + '}'
  );
}

/**
 * Auto-translate all DOM elements marked with data-i18n="key".
 * If an element additionally has data-i18n-attr="title,placeholder", those
 * attributes will be translated too instead of textContent.
 *
 * Called once on init and again on every setLocale().
 */
export function applyTranslations(root = document) {
  const nodes = root.querySelectorAll('[data-i18n]');
  for (const el of nodes) {
    const key = el.getAttribute('data-i18n');
    const attrList = el.getAttribute('data-i18n-attr');
    if (attrList) {
      for (const a of attrList.split(',').map(s => s.trim()).filter(Boolean)) {
        el.setAttribute(a, t(key));
      }
    } else {
      // Only touch textContent if the element has no HTML children we'd wipe
      // out. Elements with mixed content should use dedicated JS updates.
      if (el.children.length === 0) {
        el.textContent = t(key);
      } else {
        // Try to update a designated text-only child (span with .i18n-slot)
        const slot = el.querySelector('.i18n-slot');
        if (slot) slot.textContent = t(key);
      }
    }
  }
}
