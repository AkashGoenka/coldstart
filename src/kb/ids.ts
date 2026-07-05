/**
 * Note ids — opaque join keys. Coined once, then only ever reused; never
 * searched, never re-derived (so they cannot rot). Retrieval runs over
 * title/aliases/prose/anchors, not ids.
 *
 * - File notes: id derived from the repo-relative path, collision-safe
 *   (`a/b_c.py` and `a/b/c.py` slug identically — the sha1 suffix disambiguates).
 * - Flow/lesson notes: id coined from the title at first write; uniqueness
 *   against existing ids by numeric suffix. Two-phase reuse is enforced at the
 *   `kb write` layer, not here.
 */
import { createHash } from 'node:crypto';

const SLUG_MAX = 60;

export function slugify(s: string): string {
  const slug = String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.slice(0, SLUG_MAX).replace(/-+$/g, '');
}

/** Derived, repeatable, collision-safe id for a file note. */
export function fileNoteId(relPath: string): string {
  const sha = createHash('sha1').update(relPath).digest('hex').slice(0, 8);
  const slug = slugify(relPath);
  return slug ? `${slug}-${sha}` : sha;
}

/** Coin a fresh flow/lesson id from a title; suffix -2, -3… if taken. */
export function coinId(title: string, existingIds: ReadonlySet<string>): string {
  const base = slugify(title) || 'note';
  if (!existingIds.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!existingIds.has(candidate)) return candidate;
  }
}

/** Ids double as `.raw`/md filenames — keep them filesystem- and wikilink-safe. */
export function isValidId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,99}$/.test(id);
}
