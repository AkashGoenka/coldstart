/**
 * Render — FoldedNote → derived markdown (never load-bearing for retrieval;
 * search consumes the FoldedNote directly, so this file is the human/Obsidian
 * view and what recall inlines).
 *
 * Dual layer: frontmatter = machine contract (OKF-conformant: `type` present,
 * unknown fields preserved), body = agent prose (grepped, never parsed).
 * Anchors render as one JSON object per line (valid YAML flow mapping, and
 * trivially machine-readable back). Freshness is NEVER rendered — it is
 * computed at read time; a rendered stamp would be stale-at-write.
 *
 * Ecosystem conventions: `aliases` (Obsidian frontmatter), `[[wikilink]]`
 * concept references in prose.
 */
import type { FoldedNote } from './types.js';

const yamlStr = (s: string): string => JSON.stringify(String(s));

export function renderNote(note: FoldedNote): string {
  const fm: string[] = ['---'];
  fm.push(`id: ${note.id}`);
  fm.push(`type: ${note.type}`);
  if (note.character) fm.push(`character: ${note.character}`);
  if (note.kind) fm.push(`kind: ${note.kind}`);
  fm.push(`title: ${yamlStr(note.title)}`);
  if (note.aliases.length) fm.push(`aliases: [${note.aliases.map(yamlStr).join(', ')}]`);
  if (note.anchors.length) {
    fm.push('anchors:');
    for (const a of note.anchors) fm.push(`  - ${JSON.stringify(a)}`);
  }
  if (note.scope) fm.push(`scope: ${JSON.stringify(note.scope)}`);
  fm.push(`status: ${note.status}`);
  if (note.supersededBy) fm.push(`superseded_by: ${note.supersededBy}`);
  fm.push(`updated: ${note.updated}`);
  fm.push(`edits: ${note.edits}`);
  // Tolerant reader: unknown record fields survive into the frontmatter.
  for (const [k, v] of Object.entries(note.extra)) {
    if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k)) fm.push(`${k}: ${JSON.stringify(v)}`);
  }
  fm.push('---');

  const body: string[] = ['', `# ${note.title}`, ''];

  if (note.status === 'superseded' && note.supersededBy) {
    body.push(`> Superseded by [[${note.supersededBy}]].`, '');
  }
  if (note.status === 'retracted') {
    body.push(`> Retracted — kept for history; do not rely on this note.`, '');
  }

  if (note.type === 'file') renderFileBody(note, body);
  else if (note.type === 'flow') renderFlowBody(note, body);
  else renderLessonBody(note, body);

  return fm.join('\n') + '\n' + body.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

function renderFileBody(note: FoldedNote, body: string[]): void {
  if (note.summary) body.push(note.summary, '');
  if (note.facets.length) {
    body.push('## Facets', '');
    for (const f of note.facets) {
      const flows = f.flows?.length ? ` — ${f.flows.map((x) => `[[${x}]]`).join(' ')}` : '';
      body.push(`- **${f.symbol}** — ${f.detail}${flows}`);
    }
    body.push('');
  }
  if (note.behaviors.length) {
    body.push('## Behaviors', '');
    for (const b of note.behaviors) {
      const sym = b.symbols?.length ? ` (\`${b.symbols.join('`, `')}\`)` : '';
      body.push(`- **${b.concept_id}**${sym} — ${b.detail}`);
    }
    body.push('');
  }
  if (note.features.length) {
    body.push('## Part of', '');
    for (const f of note.features) body.push(`- [[${f.concept_id}]]${f.role ? ` — ${f.role}` : ''}`);
    body.push('');
  }
}

function renderFlowBody(note: FoldedNote, body: string[]): void {
  if (note.summary) body.push(note.summary, '');
  if (note.steps.length) {
    body.push('## Steps', '');
    note.steps.forEach((s, i) => {
      const sym = s.symbols?.length ? ` (\`${s.symbols.join('`, `')}\`)` : '';
      body.push(`${i + 1}. \`${s.path}\`${sym} — ${s.role}`);
    });
    body.push('');
  }
  if (note.invariants.length) {
    body.push('## Invariants', '');
    for (const inv of note.invariants) body.push(`- ${inv}`);
    body.push('');
  }
}

function renderLessonBody(note: FoldedNote, body: string[]): void {
  if (note.body) body.push(note.body, '');
  if (note.scope) {
    body.push('## Scope (absence — freshness = re-run this search)', '');
    body.push(`- terms: ${note.scope.terms.map((t) => `\`${t}\``).join(', ')}`);
    if (note.scope.globs?.length) body.push(`- globs: ${note.scope.globs.map((g) => `\`${g}\``).join(', ')}`);
    body.push('');
  }
}
