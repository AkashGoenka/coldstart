// Generate the notebook browser page for coldstartmcp.dev.
//
// The site page is the SAME viewer `coldstart kb view` produces — one
// self-contained HTML file, no dependencies — with this repo's own real
// notebook baked in. Same pattern as scripts/graph-viewer/build-site-page.mjs.
//
//   npm run build && node scripts/kb-viewer/build-site-page.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const DIST = join(ROOT, 'dist');
const OUT = join(ROOT, 'site-astro', 'src', 'notebook-page.html');

const distImport = (...p) => import(pathToFileURL(join(DIST, ...p)).href);

let buildViewData, renderViewHtml, VIEW_TEMPLATE;
try {
  ({ buildViewData, renderViewHtml } = await distImport('kb', 'view.js'));
  ({ VIEW_TEMPLATE } = await distImport('kb', 'view-template.js'));
} catch (err) {
  console.error('could not load dist/ — run `npm run build` first.\n' + err.message);
  process.exit(1);
}

// The home link must be substituted into the TEMPLATE first: renderViewHtml
// clears the slot for the standalone CLI page, which has nowhere to go back to.
const template = VIEW_TEMPLATE.replace(
  '<!--__HOME_LINK__-->', '<a id="home" href="/">← coldstartmcp.dev</a>',
);

const generated = new Date().toISOString().slice(0, 10);
const data = buildViewData(ROOT, generated);
const html = renderViewHtml(template, data);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
console.log(
  `${OUT}  (${(Buffer.byteLength(html) / 1024 | 0)}KB, ${data.notes.length} notes)`,
);
