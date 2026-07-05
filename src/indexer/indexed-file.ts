import { statSync } from 'node:fs';
import type { IndexedFile, Language, ParsedFile } from '../types.js';

/**
 * The portion of an IndexedFile that is derived purely from identity + the
 * parser output — i.e. every field EXCEPT the five that each call site computes
 * itself: `domainMap`, `isTestFile`, `importedByCount`,
 * `transitiveImportedByCount`, `isBarrel`.
 *
 * Three places build IndexedFiles (full index, incremental patch, probe). They
 * used to hand-copy ~20 fields each, and they drifted: the patch path silently
 * dropped `constantReferences` / `djangoConventionRefs` / etc., which deleted a
 * file's synthetic (convention) edges on every incremental edit. Constructing
 * the shared fields from one function keeps the three in lock-step.
 */
export function baseIndexedFile(
  id: string,
  path: string,
  relativePath: string,
  language: Language,
  parsed: ParsedFile,
): Omit<
  IndexedFile,
  'domainMap' | 'isTestFile' | 'importedByCount' | 'transitiveImportedByCount' | 'isBarrel'
> {
  // Fingerprint stamped at parse time: the parser just read this exact content,
  // so stat-now describes the bytes the index reflects. Reconcile compares
  // stat-later against this pair to detect edits without hashing.
  let mtimeMs: number | undefined, sizeBytes: number | undefined;
  try {
    const st = statSync(path);
    mtimeMs = st.mtimeMs;
    sizeBytes = st.size;
  } catch { /* raced delete — fingerprint stays absent */ }
  return {
    id,
    path,
    relativePath,
    language,
    mtimeMs,
    sizeBytes,
    exports: parsed.exports,
    hasDefaultExport: parsed.hasDefaultExport,
    imports: parsed.imports,
    hash: parsed.hash,
    lineCount: parsed.lineCount,
    tokenEstimate: parsed.tokenEstimate,
    symbols: parsed.symbols,
    reexportRatio: parsed.reexportRatio,
    packageName: parsed.packageName,
    constantReferences: parsed.constantReferences,
    partialDeclarations: parsed.partialDeclarations,
    eloquentRelations: parsed.eloquentRelations,
    containerResolutions: parsed.containerResolutions,
    djangoConventionRefs: parsed.djangoConventionRefs,
    submoduleImportCandidates: parsed.submoduleImportCandidates,
    contentTokens: parsed.contentTokens,
  };
}
