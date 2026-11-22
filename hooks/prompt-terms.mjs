// Prompt reducer: turns what the user typed into the term list `find` (and the
// recall lane) is queried with. Production port of the pilot reducer's shipped
// variant `fix` (coldstart-rag scripts/pilot-find/reduce2.ts):
//   terms = [...ids (deduped case-insensitively, last spelling wins), ...NOUN/PROPN words]
// Design: docs/embedder-daemon-design.md §5 "Prompt reducer".
//
// Plain ESM library (no regex-engine import: that is for wired entry scripts).
// wink-nlp + its English model load lazily on the first reducePrompt() call,
// synchronously via createRequire, so importing this module costs nothing.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** @type {{ nlp: any, its: any } | null} */
let wink = null;
/** @type {number | null} */
let loadedMs = null;

function loadWink() {
  if (wink) return wink;
  const t0 = performance.now();
  const winkNLP = require('wink-nlp');
  const model = require('wink-eng-lite-web-model');
  const nlp = winkNLP(model);
  wink = { nlp, its: nlp.its };
  loadedMs = performance.now() - t0;
  return wink;
}

/** Load the POS model now (e.g. to time it or warm a process). Returns load ms. */
export function loadPromptModel() {
  loadWink();
  return /** @type {number} */ (loadedMs);
}

/** Model-load cost in ms, or null when the model has not been loaded yet. */
export function promptModelLoadMs() {
  return loadedMs;
}

// Lowercase hyphen compounds (multi-file, symbol-table) are prose, not ids.
export const isProseCompound = (w) => /^[a-z]+(-[a-z]+)+$/.test(w);
// Dotted letter abbreviations (e.g, i.e.) are prose, not ids.
export const isAbbrev = (w) => /^[a-z](\.[a-z])+\.?$/i.test(w);
// Identifier shape: inner _./- between alnums, camelCase, 2+ capitals, or letter+digit.
export const isId = (w) => !isProseCompound(w) && !isAbbrev(w) &&
  (/[A-Za-z0-9][_./-][A-Za-z0-9]/.test(w) || /[a-z][A-Z]/.test(w) || /[A-Z].*[A-Z]/.test(w) || (/[A-Za-z]/.test(w) && /\d/.test(w)));

// An all-letters ALL-CAPS word is an acronym (JSON, MCP, UI) or emphasis (NOT, ONLY, MUST, IMPORTANT). It stays an id
// only when the POS tagger calls it a NOUN/PROPN and it isn't a known emphasis word (wink tags IMPORTANT/NOTE PROPN).
export const MAX_ID_LEN = 80;
const ALL_CAPS = /^[A-Z]+$/;
export const EMPHASIS = new Set(['IMPORTANT', 'CRITICAL', 'NOTE', 'PLEASE', 'ALWAYS', 'NEVER', 'MUST', 'ONLY', 'NOT', 'ALL',
  'DONT', 'YES', 'NO', 'OK', 'VERY', 'REALLY', 'EXACTLY', 'ANY', 'EVERY', 'NOW', 'STOP', 'WARNING', 'ASAP', 'FYI', 'BTW', 'IMO',
  'THE', 'AND', 'OR', 'BUT', 'IF', 'DO', 'IS', 'ARE', 'SHOULD', 'NEED', 'WANT', 'HERE', 'THIS', 'THAT', 'WHY', 'HOW', 'WHAT']);

const QUOTED_LABEL = /(?:^|[\s(])['"‘“]([A-Za-z][^'"’”]{2,60}?)['"’”](?=[\s,.?;:)]|$)/g;

/** Identifiers by char offset in the raw text, plus quoted 2-4-word UI labels as CamelCase ids. */
function identifiers(p) {
  const ids = [], spans = [];
  // Quoted UI labels → CamelCase. No span: the words stay in the text for POS too.
  for (const m of p.matchAll(QUOTED_LABEL)) {
    const ws = m[1].split(/\s+/).filter(Boolean);
    if (ws.length >= 2 && ws.length <= 4) ids.push(ws.map((w) => w[0].toUpperCase() + w.slice(1)).join('').replace(/[^A-Za-z0-9_]/g, ''));
  }
  for (const m of p.matchAll(/\S+/g)) {
    const lead = m[0].match(/^[^A-Za-z0-9_]*/)[0].length;
    const w = m[0].slice(lead).replace(/[^A-Za-z0-9_]+$/, '').replace(/'s$/, '');
    // a pasted token/hash/base64 blob is never a name anyone declared (and JWT-ish strings once hung the index)
    if (w && w.length <= MAX_ID_LEN && isId(w)) { ids.push(w); spans.push({ a: m.index + lead, b: m.index + lead + w.length, caps: ALL_CAPS.test(w) }); }
  }
  return { ids, spans };
}

/** wink tokens with POS, mapped back to char offsets by sequential search. */
function tagged(p) {
  const { nlp, its } = loadWink();
  const doc = nlp.readDoc(p), toks = doc.tokens().out(), pos = doc.tokens().out(its.pos);
  let at = 0;
  return toks.map((t, i) => {
    const a = p.indexOf(t, at);
    if (a >= 0) at = a + t.length;
    return { t, pos: pos[i], a };
  });
}

/**
 * Reduce a user-typed prompt to search terms.
 * @param {string} text
 * @returns {{ terms: string[], ids: string[], nouns: string[], skip: boolean }}
 */
export function reducePrompt(text) {
  const p = typeof text === 'string' ? text : '';
  const { ids: idsFound, spans } = identifiers(p);
  const inId = (a) => spans.some((s) => a >= s.a && a < s.b);
  const toks = p.trim() ? tagged(p) : [];
  // ALL-CAPS gate (see ALL_CAPS): drop emphasis words, keep acronyms the tagger reads as nouns
  const posAt = new Map(toks.map((k) => [k.a, k.pos]));
  const dropped = new Set(spans.filter((s) => s.caps && (EMPHASIS.has(p.slice(s.a, s.b)) || !['NOUN', 'PROPN'].includes(posAt.get(s.a))))
    .map((s) => p.slice(s.a, s.b)));
  const kept = new Set(spans.filter((s) => s.caps && !dropped.has(p.slice(s.a, s.b))).map((s) => p.slice(s.a, s.b)));
  const rawIds = idsFound.filter((x) => !dropped.has(x) || kept.has(x));
  const seen = new Set(rawIds.map((x) => x.toLowerCase()));
  const nouns = [];
  if (toks.length) {
    for (const k of toks) {
      if (k.a < 0 || k.t.length < 3 || inId(k.a) || !/^[A-Za-z][A-Za-z0-9]*$/.test(k.t)) continue;
      if (k.pos !== 'NOUN' && k.pos !== 'PROPN') continue;
      const lo = k.t.toLowerCase();
      if (seen.has(lo)) continue;
      seen.add(lo);
      nouns.push(k.t);
    }
  }
  // Dedupe ids case-insensitively; Map keeps the first key position, last spelling (pilot behaviour).
  const ids = [...new Map(rawIds.map((x) => [x.toLowerCase(), x])).values()];
  const terms = [...ids, ...nouns];
  return { terms, ids, nouns, skip: terms.length < 2 };
}
