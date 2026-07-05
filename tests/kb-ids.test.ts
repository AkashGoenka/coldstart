import { describe, it, expect } from 'vitest';
import { slugify, fileNoteId, coinId, isValidId } from '../src/kb/ids.js';

describe('kb ids', () => {
  it('fileNoteId is repeatable and collision-safe where plain slugs collide', () => {
    // These two distinct paths slug identically — the sha1 suffix must split them.
    const a = fileNoteId('a/b_c.py');
    const b = fileNoteId('a/b/c.py');
    expect(slugify('a/b_c.py')).toEqual(slugify('a/b/c.py'));
    expect(a).not.toEqual(b);
    expect(fileNoteId('a/b_c.py')).toEqual(a); // repeatable
    expect(isValidId(a)).toBe(true);
  });

  it('slugify caps length and never ends with a dash', () => {
    const long = slugify('x'.repeat(80) + '/deep/path.ts');
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long.endsWith('-')).toBe(false);
  });

  it('coinId uses the title slug and suffixes on collision', () => {
    const existing = new Set(['auth-token-refresh', 'auth-token-refresh-2']);
    expect(coinId('Auth token refresh!', new Set())).toBe('auth-token-refresh');
    expect(coinId('Auth token refresh!', existing)).toBe('auth-token-refresh-3');
    expect(coinId('***', new Set())).toBe('note'); // degenerate title
  });

  it('isValidId rejects filesystem-hostile ids', () => {
    expect(isValidId('good-id-2')).toBe(true);
    expect(isValidId('')).toBe(false);
    expect(isValidId('-leading-dash')).toBe(false);
    expect(isValidId('has/slash')).toBe(false);
    expect(isValidId('Upper')).toBe(false);
    expect(isValidId('dot.dot')).toBe(false);
  });
});
