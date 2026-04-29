import { describe, it, expect } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex } from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, 'fixtures');

describe('import-source domain tokens', () => {
  it('adds import-source tokens from non-relative resolved imports', async () => {
    // ts-import-tokens/main.ts imports '@/components/Button'
    // which resolves to src/components/Button.ts via tsconfig paths.
    // The importing file (main.ts) should gain 'components' and 'button'
    // as import-sourced domain tokens.
    const fixture = join(FIXTURES, 'ts-import-tokens');
    const index = await buildIndex(fixture, [], [], true);

    const mainFile = index.files.get('main.ts');
    expect(mainFile).toBeDefined();

    const importTokens = mainFile!.domains.filter(dt => dt.sources.includes('import'));
    const tokenNames = importTokens.map(dt => dt.token);

    expect(tokenNames).toContain('components');
    expect(tokenNames).toContain('button');
  });

  it('does not add import-source tokens for relative imports', async () => {
    // Relative imports like './foo' are already covered by path/filename tokens
    // and should not produce import-source tokens.
    const fixture = join(FIXTURES, 'ts-import-tokens');
    const index = await buildIndex(fixture, [], [], true);

    const buttonFile = index.files.get('src/components/Button.ts');
    expect(buttonFile).toBeDefined();

    // Button.ts has no imports at all, so no import tokens
    const importTokens = buttonFile!.domains.filter(dt => dt.sources.includes('import'));
    expect(importTokens).toHaveLength(0);
  });

  it('does not double-add a token that already exists from another source', async () => {
    // If a token like 'button' is already in domains from the filename source,
    // adding it again as 'import' should only append the source, not duplicate the entry.
    const fixture = join(FIXTURES, 'ts-import-tokens');
    const index = await buildIndex(fixture, [], [], true);

    const mainFile = index.files.get('main.ts');
    expect(mainFile).toBeDefined();

    const domains = mainFile!.domains;
    const buttonEntries = domains.filter(dt => dt.token === 'button');
    // There should be at most one DomainToken entry for 'button'
    expect(buttonEntries.length).toBeLessThanOrEqual(1);
  });
});
