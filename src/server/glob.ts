// Minimal minimatch-style glob matcher for the GO `path` field.
//
// Supports `**`, `*`, `?`, and `!`-prefix negation. Patterns are joined with
// commas (whitespace tolerated) — a path matches the set iff it matches at
// least one positive pattern (or none are given) AND no negative pattern.
//
// Not supported: `{a,b}` braces, character classes `[abc]`. Add later if a
// real use case shows up.

function globToRegExp(glob: string): RegExp {
  let pattern = '';
  let i = 0;
  while (i < glob.length) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        // `**` — any depth, including zero. Consume a trailing `/` so that
        // patterns like `a/**/b` match `a/b` (zero intermediate segments).
        pattern += '.*';
        i += 2;
        if (glob[i] === '/') i++;
      } else {
        pattern += '[^/]*';
        i++;
      }
    } else if (ch === '?') {
      pattern += '[^/]';
      i++;
    } else if ('.+^$()|[]\\{}'.includes(ch)) {
      pattern += '\\' + ch;
      i++;
    } else {
      pattern += ch;
      i++;
    }
  }
  return new RegExp('^' + pattern + '$');
}

export interface CompiledGlob {
  positives: RegExp[];
  negatives: RegExp[];
}

export function compileGlob(spec: string): CompiledGlob {
  const positives: RegExp[] = [];
  const negatives: RegExp[] = [];
  for (const raw of spec.split(',')) {
    const p = raw.trim();
    if (!p) continue;
    if (p.startsWith('!')) {
      negatives.push(globToRegExp(p.slice(1)));
    } else {
      positives.push(globToRegExp(p));
    }
  }
  return { positives, negatives };
}

export function matchesGlob(path: string, compiled: CompiledGlob): boolean {
  const normalized = path.replace(/\\/g, '/');
  for (const neg of compiled.negatives) {
    if (neg.test(normalized)) return false;
  }
  if (compiled.positives.length === 0) return true;
  for (const pos of compiled.positives) {
    if (pos.test(normalized)) return true;
  }
  return false;
}
