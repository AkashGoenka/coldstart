/**
 * #149: every child_process call (execFile/execFileSync/spawn) must pass
 * windowsHide: true, or it flashes a visible console window on Windows —
 * confirmed via a real windows-latest CI repro (see scripts/win-repro/).
 * This scans every call site so a future one can't be added without the
 * flag; it's a static, cross-platform guard, not a runtime repro.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const BASE_NAMES = ['execFileSync', 'execFile', 'spawnSync', 'spawn'];

/** Local aliases of the base child_process names — e.g. this repo's
 *  `const execFileAsync = promisify(execFile);` — so a promisified wrapper
 *  isn't invisible to the scan just because it isn't spelled "execFile(". */
function localAliases(content: string): string[] {
  const aliases: string[] = [];
  const promisified = content.matchAll(/const\s+(\w+)\s*=\s*promisify\((\w+)\)/g);
  for (const m of promisified) {
    if (BASE_NAMES.includes(m[2])) aliases.push(m[1]);
  }
  const renamedImport = content.matchAll(/\{\s*(\w+)\s+as\s+(\w+)\s*\}/g);
  for (const m of renamedImport) {
    if (BASE_NAMES.includes(m[1])) aliases.push(m[2]);
  }
  return aliases;
}

function listFiles(dir: string, exts: string[], out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === 'vendor' || entry === '.git') continue;
      listFiles(full, exts, out);
    } else if (exts.some((e) => entry.endsWith(e)) && !entry.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** Extracts the balanced-paren statement starting at a `name(` match. */
function callStatement(content: string, openParenIndex: number): string {
  let depth = 0;
  for (let i = openParenIndex; i < content.length; i++) {
    if (content[i] === '(') depth++;
    else if (content[i] === ')') {
      depth--;
      if (depth === 0) return content.slice(openParenIndex, i + 1);
    }
  }
  return content.slice(openParenIndex, openParenIndex + 400);
}

/** Resolves a bare identifier arg (e.g. `opts`) back to its `const opts = {...}` definition. */
function resolvesToWindowsHide(content: string, statement: string): boolean {
  if (statement.includes('windowsHide')) return true;
  const varMatch = statement.match(/,\s*([A-Za-z_$][\w$]*)\s*\)\s*$/);
  if (!varMatch) return false;
  const varName = varMatch[1];
  const defRe = new RegExp(`const\\s+${varName}\\s*=\\s*\\{`);
  const defMatch = defRe.exec(content);
  if (!defMatch) return false;
  const objStart = content.indexOf('{', defMatch.index);
  const obj = callStatement(content, objStart);
  return obj.includes('windowsHide');
}

describe('#149 windowsHide coverage', () => {
  const files = [
    ...listFiles(join(ROOT, 'src'), ['.ts']),
    ...listFiles(join(ROOT, 'hooks'), ['.mjs']),
  ];

  it('found source files to scan (sanity check the scanner itself runs)', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  /** Blanks out comment text (keeping line/offset structure) so a word like
   *  "spawn" inside a comment can't be mistaken for a call site. */
  function stripComments(src: string): string {
    return src
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
      .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
  }

  for (const file of files) {
    const rel = file.slice(ROOT.length + 1);
    const content = readFileSync(file, 'utf8');
    const scanContent = stripComments(content);
    const names = [...BASE_NAMES, ...localAliases(scanContent)];
    const callRe = new RegExp(`\\b(${names.join('|')})\\s*\\(`, 'g');
    const matches = [...scanContent.matchAll(callRe)];
    if (matches.length === 0) continue;

    it(`${rel}: every execFile/execFileSync/spawn call passes windowsHide`, () => {
      const missing: number[] = [];
      for (const m of matches) {
        const openParen = m.index! + m[0].length - 1;
        const statement = callStatement(scanContent, openParen);
        if (!resolvesToWindowsHide(scanContent, statement)) {
          const line = scanContent.slice(0, m.index).split('\n').length;
          missing.push(line);
        }
      }
      expect(missing, `missing windowsHide at line(s): ${missing.join(', ')}`).toEqual([]);
    });
  }
});
