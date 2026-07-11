// Verify every locale has the exact same key set as en.js (the reference).
// Missing keys → falls back to English silently, which is a bug we want to catch.

import { en } from '../src/i18n/locales/en.js';
import { ru } from '../src/i18n/locales/ru.js';
import { de } from '../src/i18n/locales/de.js';
import { fr } from '../src/i18n/locales/fr.js';
import { es } from '../src/i18n/locales/es.js';
import { pl } from '../src/i18n/locales/pl.js';
import { zh } from '../src/i18n/locales/zh.js';
import { ja } from '../src/i18n/locales/ja.js';
import { ko } from '../src/i18n/locales/ko.js';
import { ar } from '../src/i18n/locales/ar.js';
import { hi } from '../src/i18n/locales/hi.js';
import { pt } from '../src/i18n/locales/pt.js';
import { id } from '../src/i18n/locales/id.js';
import { tr } from '../src/i18n/locales/tr.js';
import { vi } from '../src/i18n/locales/vi.js';
import { it } from '../src/i18n/locales/it.js';
import { bn } from '../src/i18n/locales/bn.js';
import { ur } from '../src/i18n/locales/ur.js';
import { fa } from '../src/i18n/locales/fa.js';
import { uk } from '../src/i18n/locales/uk.js';
import { ta } from '../src/i18n/locales/ta.js';
import { te } from '../src/i18n/locales/te.js';
import { th } from '../src/i18n/locales/th.js';
import { he } from '../src/i18n/locales/he.js';
import { el } from '../src/i18n/locales/el.js';
import { cs } from '../src/i18n/locales/cs.js';

const TABLES = {
  en, ru, de, fr, es, pl, zh, ja, ko, ar, hi,
  pt, id, tr, vi, it, bn, ur, fa, uk, ta, te, th, he, el, cs,
};

function collectKeys(obj, prefix = '') {
  const keys = [];
  for (const k of Object.keys(obj)) {
    const path = prefix ? prefix + '.' + k : k;
    if (obj[k] && typeof obj[k] === 'object' && !Array.isArray(obj[k])) {
      keys.push(...collectKeys(obj[k], path));
    } else {
      keys.push(path);
    }
  }
  return keys.sort();
}

const refKeys = collectKeys(en);
console.log('Reference (en): ' + refKeys.length + ' translation keys');

let anyFail = false;
for (const [code, tbl] of Object.entries(TABLES)) {
  if (code === 'en') continue;
  const keys = collectKeys(tbl);
  const missing = refKeys.filter(k => !keys.includes(k));
  const extra   = keys.filter(k => !refKeys.includes(k));
  const status = (missing.length === 0 && extra.length === 0) ? 'PASS' : 'FAIL';
  const detail = missing.length || extra.length
    ? '  missing=' + missing.length + '  extra=' + extra.length
    : '';
  console.log('  ' + code + ': ' + keys.length + ' keys — ' + status + detail);
  if (missing.length) console.log('    missing: ' + missing.slice(0, 5).join(', ') + (missing.length > 5 ? ' …' : ''));
  if (extra.length)   console.log('    extra:   ' + extra.slice(0, 5).join(', ')   + (extra.length > 5 ? ' …' : ''));
  if (status === 'FAIL') anyFail = true;
}

// Also check interpolation vars line up. E.g. if en has "{ms}" the translation
// should too — otherwise the display will show a literal "{ms}".
const varRegex = /\{(\w+)\}/g;
function extractVars(str) {
  const out = new Set();
  let m;
  while ((m = varRegex.exec(str)) !== null) out.add(m[1]);
  return out;
}
function lookupFlat(obj, path) {
  return path.split('.').reduce((o, k) => o?.[k], obj);
}

let varMismatch = 0;
for (const key of refKeys) {
  const enVal = lookupFlat(en, key);
  if (typeof enVal !== 'string') continue;
  const enVars = extractVars(enVal);
  if (enVars.size === 0) continue;
  for (const [code, tbl] of Object.entries(TABLES)) {
    if (code === 'en') continue;
    const val = lookupFlat(tbl, key);
    if (typeof val !== 'string') continue;
    const vars = extractVars(val);
    for (const v of enVars) {
      if (!vars.has(v)) {
        console.log('  var-miss ' + code + '/' + key + ': needs {' + v + '}');
        varMismatch++;
      }
    }
  }
}
console.log('\nInterpolation-variable mismatches: ' + varMismatch);
if (varMismatch > 0) anyFail = true;

if (anyFail) {
  console.log('\n✗ FAIL');
  process.exit(1);
} else {
  console.log('\n✓ All locales have matching keys and interpolation vars');
}
