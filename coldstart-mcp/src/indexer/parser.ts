import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, extname } from 'node:path';
import {
  LANGUAGE_CONFIGS,
  DOMAIN_KEYWORDS,
  ENTRY_POINT_NAMES,
  ARCH_ROLE_PATTERNS,
} from '../constants.js';
import type { Language, ParsedFile, ArchRole } from '../types.js';

const MAX_FILE_SIZE = 1_000_000; // 1 MB

export async function parseFile(
  filePath: string,
  language: Language,
): Promise<ParsedFile | null> {
  let content: string;
  try {
    const buf = await readFile(filePath);
    if (buf.length > MAX_FILE_SIZE) return null;
    content = buf.toString('utf-8');
  } catch {
    return null;
  }

  const hash = createHash('md5').update(content).digest('hex');
  const lineCount = content.split('\n').length;
  const tokenEstimate = Math.ceil(content.length / 4);

  const config = LANGUAGE_CONFIGS[language];

  // -------------------------------------------------------------------------
  // Extract imports
  // -------------------------------------------------------------------------
  const imports: string[] = [];
  for (const pattern of config.importPatterns) {
    const re = new RegExp(pattern.source, pattern.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      const raw = m[1]?.trim();
      if (!raw) continue;

      if (language === 'go' && raw.includes('\n')) {
        // Multiline Go import block — extract each quoted path
        const inner = raw.match(/"([^"]+)"/g);
        if (inner) {
          for (const s of inner) imports.push(s.replace(/"/g, ''));
        }
      } else if (language === 'python') {
        // "import X, Y" — split on comma
        for (const part of raw.split(',')) {
          const t = part.trim().split(/\s+/)[0];
          if (t) imports.push(t);
        }
      } else {
        imports.push(raw);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Extract exports
  // -------------------------------------------------------------------------
  const exports: string[] = [];
  let hasDefaultExport = false;

  for (const pattern of config.exportPatterns) {
    const re = new RegExp(pattern.source, pattern.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      // export default
      if (m[0].includes('export default') || m[0].includes('module.exports')) {
        hasDefaultExport = true;
        continue;
      }

      if (language === 'python') {
        const fullMatch = m[0];
        // __all__ = [...]  — parse list literal
        if (fullMatch.includes('__all__')) {
          const listContent = m[1];
          if (listContent) {
            const names = listContent.match(/['"]([A-Za-z_]\w*)['"]|(\b[A-Za-z_]\w*\b)/g);
            if (names) {
              for (const n of names) {
                const clean = n.replace(/['"]/g, '').trim();
                if (clean && !clean.startsWith('_')) exports.push(clean);
              }
            }
          }
          continue;
        }
        // def / class — skip private (underscore prefix)
        const name = m[1];
        if (name && !name.startsWith('_')) exports.push(name);
        continue;
      }

      if (language === 'ruby') {
        // def self.method_name — capture group 2
        const name = m[2] || m[1];
        if (name && !name.startsWith('_')) exports.push(name);
        continue;
      }

      // For export { X, Y } patterns (group 1 contains multiple names)
      if (m[1] && /,/.test(m[1])) {
        const names = m[1]
          .split(',')
          .map(s => s.trim().split(/\s+as\s+/)[0].trim())
          .filter(n => n && n !== '*' && /^\w/.test(n));
        exports.push(...names);
        continue;
      }

      const name = m[1];
      if (name && /^\w/.test(name) && name.length < 80) {
        exports.push(name);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Deduplicate
  // -------------------------------------------------------------------------
  const uniqueImports = [...new Set(imports)];
  const uniqueExports = [...new Set(exports)];

  // -------------------------------------------------------------------------
  // Infer domain
  // -------------------------------------------------------------------------
  const pathLower = filePath.toLowerCase();
  const snippet = content.slice(0, 2000).toLowerCase();
  let domain = 'unknown';
  let bestScore = 0;

  for (const [dom, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      if (pathLower.includes(kw)) score += 3;
      if (snippet.includes(kw)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      domain = dom;
    }
  }

  // -------------------------------------------------------------------------
  // Detect entry point
  // -------------------------------------------------------------------------
  const base = basename(filePath, extname(filePath)).toLowerCase();
  const isEntryPoint = ENTRY_POINT_NAMES.has(base);

  // -------------------------------------------------------------------------
  // Detect architectural role from path
  // -------------------------------------------------------------------------
  let archRole: ArchRole = 'unknown';
  if (isEntryPoint) {
    archRole = 'entry';
  } else {
    const pathForRole = filePath.toLowerCase();
    for (const { pattern, role } of ARCH_ROLE_PATTERNS) {
      if (pattern.test(pathForRole)) {
        archRole = role as ArchRole;
        break;
      }
    }
  }

  return {
    imports: uniqueImports,
    exports: uniqueExports,
    hasDefaultExport,
    hash,
    lineCount,
    tokenEstimate,
    domain,
    isEntryPoint,
    archRole,
  };
}

export function buildFileId(relativePath: string): string {
  // Normalise to forward slashes for cross-platform stability
  return relativePath.replace(/\\/g, '/');
}
