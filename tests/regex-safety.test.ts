/**
 * Every regex literal in src/ and hooks/ is checked for catastrophic
 * backtracking — the "compile error" for regexes.
 *
 * Twice a single regex hung the keeper forever on one ordinary file:
 * SHAPE_CAMEL on an 82-char token (#165), then STRING_SPAN on a Ruby email
 * regex with 46 backslashes. Both run synchronously, so nothing — no timer,
 * no log, no skip — can run once they start. Both were findable statically:
 * recheck decides from the regex alone whether some input makes it blow up,
 * and hands back that input.
 *
 * The rule:
 *   - exponential (2^n)              → fail. These are the hangs.
 *   - polynomial of degree ≥ 3 (n³…) → fail. 1.5s at 20KB is minutes at the
 *     1MB file cap (the old SFC <script> extractor was one).
 *   - quadratic (n²)                 → allowed, but recheck's own worst input
 *     at 20KB must stay under a budget. Unanchored /g scans are quadratic by
 *     nature (each start position rescans), so banning n² would ban `/\n+$/`.
 *
 * Only literals are checked. A `new RegExp(dynamicString)` is invisible here;
 * keep pattern text in literals where possible.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import ts from 'typescript';
import { check } from 'recheck';

const REPO = path.resolve(__dirname, '..');
const SCAN_DIRS = ['src', 'hooks'];
const QUADRATIC_PROBE_LEN = 20_000;
// Measured worst case today is ~250ms on a dev laptop; the slack is for CI
// runners, not for a slower regex.
const QUADRATIC_BUDGET_MS = 2_000;

interface Literal { source: string; flags: string; where: string }

function collectLiterals(): Literal[] {
  const out: Literal[] = [];
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!/\.(?:ts|mjs|js)$/.test(e.name) || e.name.endsWith('.d.ts')) continue;
      const sf = ts.createSourceFile(p, fs.readFileSync(p, 'utf8'), ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node): void => {
        if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) {
          const text = node.getText(sf);
          const slash = text.lastIndexOf('/');
          const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
          out.push({ source: text.slice(1, slash), flags: text.slice(slash + 1), where: `${path.relative(REPO, p)}:${line}` });
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
  };
  for (const d of SCAN_DIRS) walk(path.join(REPO, d));
  return out;
}

type Attack = { pumps: { prefix: string; pump: string }[]; suffix: string };

/** recheck's attack string, with each pumped segment repeated out to ~len. */
function pumpAttack(attack: Attack, len: number): string {
  const unit = attack.pumps.reduce((n, p) => n + p.pump.length, 0) || 1;
  const reps = Math.ceil(len / unit);
  return attack.pumps.map((p) => p.prefix + p.pump.repeat(reps)).join('') + attack.suffix;
}

describe('regex safety (catastrophic backtracking)', () => {
  it('the checker still catches the two regexes that hung the keeper', async () => {
    // If recheck ever stops flagging these, every other assertion here is
    // meaningless — pin it.
    const shapeCamel = await check('^[a-z][a-z0-9]*(?:[A-Z][a-zA-Z0-9]*)+$', '');
    const stringSpan = await check(String.raw`(["'\`])(?:\\.|(?!\1).)*?\1`, 'g');
    expect(shapeCamel.complexity?.type).toBe('exponential');
    expect(stringSpan.complexity?.type).toBe('exponential');
  }, 60_000);

  it('no regex literal in src/ or hooks/ can blow up', async () => {
    const literals = collectLiterals();
    expect(literals.length).toBeGreaterThan(100); // the scan found the code

    // Same pattern text in several places is checked once.
    const unique = new Map<string, Literal[]>();
    for (const l of literals) {
      const key = `/${l.source}/${l.flags}`;
      unique.set(key, [...(unique.get(key) ?? []), l]);
    }

    const failures: string[] = [];
    await Promise.all([...unique.values()].map(async (sites) => {
      const { source, flags } = sites[0];
      const where = sites.map((s) => s.where).join(', ');
      const r = await check(source, flags, { timeout: 60_000 });
      if (r.status === 'unknown') {
        failures.push(`${where}: checker could not decide (${r.error?.kind ?? 'unknown'}) — /${source}/${flags}`);
        return;
      }
      if (r.status !== 'vulnerable') return;
      const c = r.complexity;
      if (c.type === 'exponential' || (c.type === 'polynomial' && c.degree >= 3)) {
        const label = c.type === 'exponential' ? 'exponential' : `polynomial degree ${c.degree}`;
        failures.push(`${where}: ${label} — /${source}/${flags} — e.g. ${JSON.stringify(r.attack.string.slice(0, 60))}`);
        return;
      }
      const re = new RegExp(source, flags.includes('g') ? flags : flags + 'g');
      const input = pumpAttack(r.attack as Attack, QUADRATIC_PROBE_LEN);
      const t0 = performance.now();
      input.replace(re, '');
      const ms = performance.now() - t0;
      if (ms > QUADRATIC_BUDGET_MS) {
        failures.push(`${where}: quadratic, ${Math.round(ms)}ms on ${input.length} chars (budget ${QUADRATIC_BUDGET_MS}ms) — /${source}/${flags}`);
      }
    }));

    expect(failures, failures.join('\n')).toEqual([]);
  }, 300_000);
});
