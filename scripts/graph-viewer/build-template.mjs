// Regenerate src/graph/view-template.ts from the HTML design source.
//
// tsc does not copy non-.ts assets into dist/, so the viewer ships as a string
// constant. sphere.template.html stays the thing you edit (open it in a
// browser, iterate), and this script bakes it. Run after any HTML/CSS/JS change:
//   node scripts/graph-viewer/build-template.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, 'sphere.template.html');
const OUT = join(HERE, '..', '..', 'src', 'graph', 'view-template.ts');

let html = readFileSync(SRC, 'utf8');

// `/*__DATA__*/null` keeps the raw file openable as valid JS while iterating;
// the shipped template takes a substitution placeholder instead.
if (!html.includes('/*__DATA__*/null')) {
  console.error('sphere.template.html no longer contains /*__DATA__*/null — nothing to bake.');
  process.exit(1);
}
html = html.replace('/*__DATA__*/null', '__DATA_JSON__');
html = html.replace(
  '<title>coldstart — codebase sphere</title>',
  '<title>__TITLE__</title>',
);

const header = `/**
 * Embedded single-file codebase graph viewer (client). GENERATED from
 * scripts/graph-viewer/sphere.template.html by
 * scripts/graph-viewer/build-template.mjs — do not hand-edit; edit the HTML and
 * re-run that script. Two placeholders are substituted by \`renderGraphHtml\`:
 * \`__TITLE__\` (the tab title) and \`__DATA_JSON__\` (the baked graph payload).
 * Shipped as a string because tsc does not copy non-.ts assets into dist.
 */
export const GRAPH_TEMPLATE = `;

writeFileSync(OUT, header + JSON.stringify(html) + ';\n');
console.log(`${OUT}  (${(Buffer.byteLength(html) / 1024).toFixed(0)}KB of template)`);
