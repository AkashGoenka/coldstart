/**
 * kb lookup — everything the notebook knows at an exact (path[, symbol])
 * address. This is the read side of the address-based dedup story: before
 * recording a file-anchored fact, an agent looks the address up; the same
 * surface answers "what do we know about this file?" during navigation.
 *
 * Flow back-links are DERIVED here at read time from flow steps (which already
 * carry {path, symbols}) — nothing is stored on the file note, so the links
 * can never go stale and there is nothing for a writer to forget.
 */
import type { AnchorState, Facet, Feature, FileCharacter, LessonKind } from './types.js';
import { fileNoteId } from './ids.js';
import { loadAll } from './store.js';
import { stampAnchors } from './freshness.js';

export interface LookupFileNote {
  id: string;
  character?: FileCharacter;
  summary?: string;
  /** All facets, or just the addressed one when a symbol was given. */
  facets: Facet[];
  /** Manual part-of pointers recorded on the note itself. */
  features: Feature[];
  state: AnchorState;
}

export interface LookupFlowHit {
  id: string;
  title: string;
  /** 1-based step positions in the flow that touch the address. */
  steps: { index: number; role: string; symbols?: string[] }[];
}

export interface LookupLessonHit {
  id: string;
  kind?: LessonKind;
  title: string;
  gist: string;
}

export interface LookupResult {
  path: string;
  symbol?: string;
  fileNote: LookupFileNote | null;
  flows: LookupFlowHit[];
  lessons: LookupLessonHit[];
  warnings: string[];
}

const normPath = (p: string): string => p.replace(/^\.\//, '');

export function kbLookup(root: string, rawPath: string, symbol?: string): LookupResult {
  const path = normPath(rawPath);
  const { notes, warnings } = loadAll(root);

  const result: LookupResult = { path, ...(symbol ? { symbol } : {}), fileNote: null, flows: [], lessons: [], warnings };

  const fnote = notes.find((n) => n.id === fileNoteId(path) && n.status === 'active');
  if (fnote) {
    const facets = symbol ? fnote.facets.filter((f) => f.symbol === symbol) : fnote.facets;
    result.fileNote = {
      id: fnote.id,
      ...(fnote.character ? { character: fnote.character } : {}),
      ...(fnote.summary ? { summary: fnote.summary } : {}),
      facets,
      features: fnote.features,
      state: stampAnchors(root, fnote.anchors.filter((a) => normPath(a.path) === path))[0]?.state ?? 'unverified',
    };
  }

  for (const n of notes) {
    if (n.status !== 'active') continue;
    if (n.type === 'flow') {
      // A step with no declared symbols can't be ruled out for a symbol query —
      // include it (surface, don't steer); symbol-declared steps must overlap.
      const steps = n.steps
        .map((s, i) => ({ s, index: i + 1 }))
        .filter(({ s }) => normPath(s.path) === path && (!symbol || !s.symbols?.length || s.symbols.includes(symbol)))
        .map(({ s, index }) => ({ index, role: s.role, ...(s.symbols?.length ? { symbols: s.symbols } : {}) }));
      if (steps.length) result.flows.push({ id: n.id, title: n.title, steps });
    } else if (n.type === 'lesson') {
      const hit = n.anchors.some((a) => normPath(a.path) === path && (!symbol || !a.symbols?.length || a.symbols.includes(symbol)));
      if (hit) {
        result.lessons.push({
          id: n.id,
          ...(n.kind ? { kind: n.kind } : {}),
          title: n.title,
          gist: (n.body ?? '').split('\n')[0].slice(0, 160),
        });
      }
    }
  }
  return result;
}

/** CLI text view. Empty result → a single "nothing recorded" line. */
export function renderLookup(r: LookupResult): string {
  const addr = r.symbol ? `${r.path} :: ${r.symbol}` : r.path;
  if (!r.fileNote && !r.flows.length && !r.lessons.length) {
    return `no notebook knowledge at ${addr} — nothing recorded yet.`;
  }
  const out: string[] = [addr];
  if (r.fileNote) {
    const f = r.fileNote;
    out.push(`file note: ${f.id}${f.character ? ` (${f.character})` : ''} [${f.state}]`);
    if (f.summary && (!r.symbol || f.character !== 'hub')) out.push(`  ${f.summary.split('\n')[0]}`);
    for (const facet of f.facets) {
      out.push(`  facet ${facet.symbol}: ${facet.detail}${facet.flows?.length ? ` — flows: ${facet.flows.map((x) => `[[${x}]]`).join(' ')}` : ''}`);
    }
    for (const feat of f.features) out.push(`  part of [[${feat.concept_id}]]${feat.role ? ` — ${feat.role}` : ''}`);
  }
  if (r.flows.length) {
    out.push(`flows touching ${addr}:`);
    for (const fl of r.flows) {
      for (const s of fl.steps) out.push(`  [[${fl.id}]] step ${s.index} — ${s.role}`);
    }
  }
  if (r.lessons.length) {
    out.push(`lessons anchored here:`);
    for (const l of r.lessons) out.push(`  [[${l.id}]]${l.kind ? ` (${l.kind})` : ''} — ${l.title}${l.gist ? `: ${l.gist}` : ''}`);
  }
  return out.join('\n');
}
