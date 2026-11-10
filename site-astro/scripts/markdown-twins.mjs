// Astro integration: after the build, write a markdown twin (index.md) beside each
// prose page's index.html. The Cloudflare Worker in ../worker serves these when a
// client sends `Accept: text/markdown`; Head.astro also advertises them via
// <link rel="alternate">. Interactive pages are skipped (no prose to extract).
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative, sep } from 'node:path';
import { parseHTML } from 'linkedom';
import TurndownService from 'turndown';

export const SKIP_PREFIXES = ['graph', 'demo', 'live', 'notebook'];
const STRIP = 'script, style, svg, nav, footer, noscript, template, [aria-hidden="true"]';

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name === 'index.html') out.push(p);
  }
  return out;
}

function makeConverter() {
  const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
  // Terminal mock-ups are <span class="ln"> lines inside .term-body; flatten to a fenced block.
  td.addRule('term', {
    filter: (n) => n.nodeName === 'DIV' && /\bterm\b/.test(n.getAttribute('class') || ''),
    replacement: (_c, n) => {
      const body = n.querySelector('.term-body') || n;
      const lines = Array.from(body.querySelectorAll('.ln, .l, .gap')).map((l) => l.textContent.replace(/\s+$/, ''));
      const text = (lines.length ? lines.join('\n') : body.textContent).trim();
      return `\n\n\`\`\`\n${text}\n\`\`\`\n\n`;
    },
  });
  const hasClass = (n, c) => new RegExp(`\\b${c}\\b`).test(n.getAttribute?.('class') || '');
  // key/value rows (flags, per-client lists): "- **key**: value"
  td.addRule('flagRow', {
    filter: (n) => n.nodeName === 'DIV' && hasClass(n, 'flag-row'),
    replacement: (_c, n) => {
      const k = n.querySelector('.fk')?.textContent.trim();
      const v = td.turndown(n.querySelector('.fv')?.innerHTML ?? '').trim();
      return k ? `\n- **${k}**: ${v}\n` : `\n- ${v}\n`;
    },
  });
  // callouts: a bold label span (.ct) followed by prose
  td.addRule('callout', {
    filter: (n) => n.nodeName === 'DIV' && hasClass(n, 'callout'),
    replacement: (_c, n) => {
      const ct = n.querySelector('.ct');
      const label = ct?.textContent.trim();
      ct?.remove();
      const body = td.turndown(n.innerHTML).trim();
      return `\n\n> ${label ? `**${label}:** ` : ''}${body}\n\n`;
    },
  });
  return td;
}

export function htmlToMarkdown(html, td, pageUrl) {
  const { document } = parseHTML(html);
  const title = (document.querySelector('title')?.textContent || '').trim();
  const root = document.querySelector('main') || document.querySelector('article') || document.body;
  root.querySelectorAll(STRIP).forEach((n) => n.remove());
  const md = td
    .turndown(root.innerHTML)
    .replace(/\]\(\//g, '](https://coldstartmcp.dev/') // site-relative links -> absolute
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return `# ${title}\n\nSource: ${pageUrl}\n\n${md}\n`;
}

export default function markdownTwins() {
  return {
    name: 'markdown-twins',
    hooks: {
      'astro:build:done': ({ dir, logger }) => {
        const outDir = fileURLToPath(dir);
        const td = makeConverter();
        let n = 0;
        for (const file of walk(outDir)) {
          const rel = relative(outDir, file).split(sep).slice(0, -1); // route segments
          if (rel.length && SKIP_PREFIXES.includes(rel[0])) continue;
          const url = `https://coldstartmcp.dev/${rel.length ? rel.join('/') + '/' : ''}`;
          const md = htmlToMarkdown(readFileSync(file, 'utf8'), td, url);
          writeFileSync(join(file, '..', 'index.md'), md);
          n++;
        }
        logger.info(`wrote ${n} markdown twins`);
      },
    },
  };
}
