import { buildRailsFqcnIndex, resolveRailsConstantCandidates } from './resolvers/ruby.js';
import { findSegmentParent } from './paths.js';
import type { Edge, IndexedFile } from '../types.js';

/**
 * Rails synthetic edges:
 *   - Constant references (Zeitwerk autoload): emitted per-AST-reference, resolved
 *     against the FQCN index built once from app/<category>/{,concerns/}/*.rb.
 *   - Controller/mailer ↔ view folder-pairing: pure path-regex matching the Rails
 *     convention. No AST, no render-call parsing. Captures relevance neighborhood
 *     (controller + all files in its view folder).
 */
export async function addRailsSyntheticEdges(
  indexedFiles: IndexedFile[],
  edges: Edge[],
  fullFileIdSet: Set<string>,
  rootDir: string,
): Promise<void> {
  const rubyFiles = indexedFiles.filter(f => f.language === 'ruby');
  if (rubyFiles.length === 0) return;

  // Locate the Rails app root. Matched against the file ID (always
  // forward-slash) rather than the OS-native absolute path — `f.path` uses `\`
  // on Windows, so the old `f.path.lastIndexOf('/app/')` never matched there
  // and every Rails repo silently got zero synthetic edges.
  // Matched on the file id (always forward-slash), never on the OS-native
  // absolute path: the old `f.path.lastIndexOf('/app/')` could not match on
  // Windows, so every Rails repo there silently got zero synthetic edges.
  const appRoot = findSegmentParent(rubyFiles, rootDir, 'app');
  if (!appRoot) return;

  const fqcnIndex = await buildRailsFqcnIndex(appRoot, fullFileIdSet, rootDir);
  const seen = new Set<string>();
  for (const e of edges) seen.add(`${e.from}|${e.to}`);

  for (const f of rubyFiles) {
    if (!f.constantReferences?.length) continue;
    for (const candidates of f.constantReferences) {
      const hit = resolveRailsConstantCandidates(candidates, fqcnIndex);
      if (!hit || hit.fileId === f.id) continue;
      const key = `${f.id}|${hit.fileId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from: f.id, to: hit.fileId, type: 'import', specifier: `const:${hit.fqcn}` });
    }
  }

  // Folder-pairing: controller/mailer ↔ views in convention folder.
  //   app/controllers/<dir>/<name>_controller.rb → app/views/<dir>/<name>/*
  //   app/mailers/<name>_mailer.rb               → app/views/<name>_mailer/*
  const viewsByDir = new Map<string, string[]>();
  for (const id of fullFileIdSet) {
    const m = id.match(/^(.*?)app\/views\/(.+)\/[^/]+$/);
    if (!m) continue;
    const key = `${m[1]}::${m[2]}`;
    let arr = viewsByDir.get(key);
    if (!arr) { arr = []; viewsByDir.set(key, arr); }
    arr.push(id);
  }
  const folderRules: Array<{ re: RegExp; viewSuffix: string }> = [
    { re: /^(.*?)app\/controllers\/(.+)_controller\.rb$/, viewSuffix: '' },
    { re: /^(.*?)app\/mailers\/(.+)_mailer\.rb$/, viewSuffix: '_mailer' },
  ];
  for (const f of indexedFiles) {
    for (const rule of folderRules) {
      const m = f.id.match(rule.re);
      if (!m) continue;
      const targets = viewsByDir.get(`${m[1]}::${m[2]}${rule.viewSuffix}`);
      if (!targets) continue;
      for (const targetId of targets) {
        const key = `${f.id}|${targetId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ from: f.id, to: targetId, type: 'import', specifier: 'convention:views' });
      }
    }
  }
}
