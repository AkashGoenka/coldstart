// Generate the interactive graph page for coldstartmcp.dev.
//
// The site page is the SAME viewer `coldstart graph` produces — one
// self-contained HTML file, no dependencies — with this repo's own graph baked
// in and a link back to the site.
//
// It lands in site-astro/src/ rather than public/, and an Astro route inlines
// it: Astro's dev server serves public/ by exact path only, so a file at
// public/graph/index.html answers /graph/index.html and 404s on /graph/ — the
// URL the nav actually links to. Production hosts resolve the directory index,
// so this was a dev-only 404, which is the worst kind: invisible in CI.
//
//   npm run build && node scripts/graph-viewer/build-site-page.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const DIST = join(ROOT, 'dist');
const OUT = join(ROOT, 'site-astro', 'src', 'graph-page.html');

const distImport = (...p) => import(pathToFileURL(join(DIST, ...p)).href);

let loadCachedIndex, loadCoChange, buildGraphPayload, renderGraphHtml, GRAPH_TEMPLATE;
try {
  ({ loadCachedIndex } = await distImport('cache', 'disk-cache.js'));
  ({ loadCoChange } = await distImport('indexer', 'cochange.js'));
  ({ buildGraphPayload } = await distImport('graph', 'dump.js'));
  ({ renderGraphHtml } = await distImport('graph', 'view.js'));
  ({ GRAPH_TEMPLATE } = await distImport('graph', 'view-template.js'));
} catch (err) {
  console.error('could not load dist/ — run `npm run build` first.\n' + err.message);
  process.exit(1);
}

const index = await loadCachedIndex(ROOT, undefined, 'gs');
if (!index) {
  console.error('no cached index for this repo — run `coldstart find anything` once first.');
  process.exit(1);
}

// The site page deliberately carries NO notebook edges: the notebook is this
// repo's private working memory, and note titles are not marketing copy.
const { payload, stats } = buildGraphPayload(
  'coldstart', index, loadCoChange(ROOT), [],
);

// The home link must be substituted into the TEMPLATE first: renderGraphHtml
// clears the slot for the standalone CLI page, which has nowhere to go back to.
const template = GRAPH_TEMPLATE.replace(
  '<!--__HOME_LINK__-->', '<a id="home" href="/">\u2190 coldstartmcp.dev</a>',
);
const html = renderGraphHtml(template, 'coldstart', { coldstart: payload });

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
console.log(
  `${OUT}  (${(Buffer.byteLength(html) / 1024 | 0)}KB, ` +
  `${stats.files} files, ${stats.edges} relations)`,
);
