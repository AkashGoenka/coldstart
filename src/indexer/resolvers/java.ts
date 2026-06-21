/**
 * JVM resolver: handles Java + Kotlin (same import syntax, same package layout).
 *
 * Imports like `com.example.user.UserRepository` map to a file path. We build
 * a one-time fully-qualified-class-name index from fileIdSet so each lookup is
 * O(1):
 *   <source-root>/com/example/user/UserRepository.java → "com.example.user.UserRepository"
 *
 * Source roots are discovered by regex on each .java/.kt path. The pattern
 * covers Maven (`src/main/java/`), Gradle, and Kotlin Multiplatform source
 * sets (`src/<set>/{java,kotlin}/`).
 *
 * Wildcard imports (com.foo.*) and Kotlin star imports return null.
 */

const SRC_LANG_RE = /(^|\/)src\/[^/]+\/(?:java|kotlin|groovy)\//;
const EXPLICIT_MARKERS = ['/target/generated-sources/', '/build/generated-sources/'];
const JVM_EXTENSIONS = ['.java', '.kt'];

interface FqcnIndex {
  // FQCN → fileId, e.g. "org.apache.kafka.common.Utils" → "clients/src/main/java/org/apache/kafka/common/Utils.java"
  byFqcn: Map<string, string>;
}

// Memoized on (fileIdSet identity, pkgById identity). pkgById changes per resolve
// cycle, so a stale path-only index from a prior cycle can't leak in.
const indexCache = new WeakMap<Set<string>, { idx: FqcnIndex; pkgById?: Map<string, string> }>();

/**
 * Build the FQCN→fileId map.
 *
 * Preferred keying is the file's *declared package* (`pkgById`): FQCN =
 * `<package>.<filename-stem>`. This is layout-independent — it resolves the same
 * whether the repo uses Maven (`src/main/java/com/foo/Bar.java`) or any other tree
 * (e.g. JMRI's `java/src/jmri/Bar.java`), because it reads the `package` line the
 * parser already extracted instead of guessing the package from the directory path.
 *
 * Files without a known package (default package, parse miss, or a non-JVM call
 * site) fall back to the source-root path regex. On Maven layouts the two agree
 * exactly, so the fallback never regresses a conventional repo.
 */
function buildFqcnIndex(fileIdSet: Set<string>, pkgById?: Map<string, string>): FqcnIndex {
  const cached = indexCache.get(fileIdSet);
  if (cached && cached.pkgById === pkgById) return cached.idx;
  const byFqcn = new Map<string, string>();

  for (const id of fileIdSet) {
    let ext: string | undefined;
    for (const e of JVM_EXTENSIONS) {
      if (id.endsWith(e)) { ext = e; break; }
    }
    if (!ext) continue;

    // Package-anchored (layout-independent): FQCN = <declared package>.<stem>.
    const pkg = pkgById?.get(id);
    if (pkg) {
      const base = id.slice(id.lastIndexOf('/') + 1, id.length - ext.length);
      const fqcn = `${pkg}.${base}`;
      if (!byFqcn.has(fqcn)) byFqcn.set(fqcn, id);
      continue;
    }

    // Fallback: derive the package from the source-root path convention.
    let pkgStart: number | null = null;
    const m = SRC_LANG_RE.exec(id);
    if (m) {
      pkgStart = m.index + m[0].length;
    } else {
      for (const marker of EXPLICIT_MARKERS) {
        const idx = id.indexOf(marker);
        if (idx !== -1) { pkgStart = idx + marker.length; break; }
      }
    }

    // Files outside any recognized source root: derive FQCN from the full path.
    // First-write-wins: don't overwrite a structured-source-root entry with a
    // less-structured one.
    const stem = id.slice(pkgStart ?? 0, id.length - ext.length);
    const fqcn = stem.replace(/\//g, '.');
    if (!byFqcn.has(fqcn)) byFqcn.set(fqcn, id);
  }

  const result: FqcnIndex = { byFqcn };
  indexCache.set(fileIdSet, { idx: result, pkgById });
  return result;
}

export async function resolveJava(
  specifier: string,
  _fromFile: string,
  fileIdSet: Set<string>,
  _rootDir: string,
  _aliasMap: Map<string, string[]>,
  pkgById?: Map<string, string>,
): Promise<string | null> {
  if (specifier.endsWith('.*')) return null;

  const { byFqcn } = buildFqcnIndex(fileIdSet, pkgById);

  const direct = byFqcn.get(specifier);
  if (direct) return direct;

  // Static imports (org.foo.Bar.CONSTANT) and inner classes (com.foo.Outer.Inner)
  // — strip the last segment and retry once.
  const lastDot = specifier.lastIndexOf('.');
  if (lastDot !== -1) {
    const trimmed = byFqcn.get(specifier.slice(0, lastDot));
    if (trimmed) return trimmed;
  }

  return null;
}

// Kotlin uses the same package/import semantics as Java; reuse the resolver.
export const resolveKotlin = resolveJava;
