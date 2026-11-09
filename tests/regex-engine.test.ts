/**
 * V8's linear-time regex fallback (hooks/regex-engine.mjs) must be on in every
 * process coldstart starts, and it only covers regexes created AFTER it is set
 * — so it has to be the first import of every entry point.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO = path.resolve(__dirname, '..');
const ENGINE = pathToFileURL(path.join(REPO, 'hooks', 'regex-engine.mjs')).href;

/** Run a catastrophic regex in a fresh node process; null = killed (hung). */
function runCatastrophic(withEngine: boolean, killAfterMs: number): string | null {
  const body = `${withEngine ? `import ${JSON.stringify(ENGINE)};` : ''}
    const re = /^(a+)+$/;  // module-level literal, like the indexer's
    process.stdout.write(String(re.test("a".repeat(40) + "!")));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', body], { timeout: killAfterMs, encoding: 'utf8' });
  return r.signal ? null : r.stdout;
}

/** First `import` statement of a source file (skips comments/shebang). */
function firstImport(file: string): string | undefined {
  const m = fs.readFileSync(file, 'utf8').match(/^import\s[^;\n]*/m);
  return m?.[0];
}

describe('linear regex fallback', () => {
  it('a backtracking-bomb regex answers fast with it, hangs without it', () => {
    expect(runCatastrophic(true, 10_000)).toBe('false');
    // Control: the same regex really does hang without the fallback, so the
    // line above is measuring the flag, not a fast machine.
    expect(runCatastrophic(false, 2_000)).toBeNull();
  }, 30_000);

  it('is the FIRST import of src/index.ts (CLI, MCP server and keeper entry)', () => {
    expect(firstImport(path.join(REPO, 'src', 'index.ts'))).toBe("import '../hooks/regex-engine.mjs'");
  });

  it('is the FIRST import of every hook script init wires', () => {
    // Derived from init's own constants, so a newly wired hook is covered.
    const init = fs.readFileSync(path.join(REPO, 'src', 'init.ts'), 'utf8');
    const hooks = [...init.matchAll(/^const (?:CODEX_|CURSOR_)?(?:KB_)?HOOK_[A-Z]+ = '([a-z-]+\.mjs)'/gm)].map(m => m[1]);
    expect(hooks.length).toBe(12);
    for (const h of hooks) {
      expect(firstImport(path.join(REPO, 'hooks', h)), h).toBe('import "./regex-engine.mjs"');
    }
  });
});
