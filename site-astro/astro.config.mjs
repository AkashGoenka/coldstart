import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';

const projectRoot = dirname(fileURLToPath(import.meta.url));

// Map a built route back to the source file it renders from, so <lastmod> can be
// the file's real last-commit date instead of the build time. Blog posts point at
// their markdown, not at [slug].astro — editing the template shouldn't restamp
// every post as "changed".
function sourceFileForRoute(pathname) {
  const segments = pathname.split('/').filter(Boolean);

  if (segments[0] === 'blog' && segments.length === 2) {
    return join('src', 'content', 'blog', `${segments[1]}.md`);
  }

  const base = join('src', 'pages', ...segments);
  for (const candidate of [`${base}.astro`, join(base, 'index.astro')]) {
    if (existsSync(join(projectRoot, candidate))) return candidate;
  }
  return null;
}

// A shallow clone (actions/checkout's default) answers `git log -1` for EVERY file
// with the single commit it has, so per-file dates come back uniform and wrong
// rather than empty. Detect that up front and emit no lastmod at all — a wrong
// lastmod on every URL teaches Google to ignore the field entirely.
const historyUsable = (() => {
  try {
    const shallow = execFileSync('git', ['rev-parse', '--is-shallow-repository'], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (shallow !== 'false') {
      console.warn('[sitemap] shallow git clone — omitting <lastmod>; set fetch-depth: 0');
      return false;
    }
    return true;
  } catch {
    console.warn('[sitemap] no git history available — omitting <lastmod>');
    return false;
  }
})();

// Empty when the file is untracked. Omit lastmod rather than substitute the build
// date, for the same reason as above.
function lastCommitDate(relPath) {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cI', '--', relPath], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

export default defineConfig({
  site: 'https://coldstartmcp.dev',
  integrations: [
    tailwind({ applyBaseStyles: false }),
    sitemap({
      serialize(item) {
        if (!historyUsable) return item;
        const source = sourceFileForRoute(new URL(item.url).pathname);
        const committed = source && lastCommitDate(source);
        if (committed) item.lastmod = committed;
        return item;
      },
    }),
  ],
});
