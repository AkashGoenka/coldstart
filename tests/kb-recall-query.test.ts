import { describe, it, expect } from 'vitest';
// @ts-expect-error — hooks are plain .mjs, no type declarations.
import { stripHarnessWrappers, recallQuery, HARNESS_TAGS } from '../hooks/recall-query.mjs';

/**
 * Recall query hygiene (2026-07-29). The hosts wrap the user's words in editor
 * and subagent telemetry; that text is file- and symbol-rich, so it hijacks the
 * path-name override in kb search and makes a stale-open editor tab drive
 * recall for turns at a time. These are the contracts that stop it.
 */

describe('stripHarnessWrappers', () => {
  it('drops the wrapper AND its content, keeping the user question that follows', () => {
    const raw = `<ide_opened_file>The user opened src/custom-functions/index.ts</ide_opened_file>\nwhy is CLAUDE.md not loading?`;
    expect(stripHarnessWrappers(raw)).toBe('why is CLAUDE.md not loading?');
  });

  it('removes the file path that would otherwise trip the path-name override', () => {
    const raw = `<ide_selection>src/keeper.ts lines 1-40</ide_selection> should we cut a release?`;
    const out = stripHarnessWrappers(raw);
    expect(out).not.toContain('keeper.ts');
    expect(out).toBe('should we cut a release?');
  });

  it('strips a subagent completion summary (<task-notification>)', () => {
    const raw = `<task-notification>Agent finished: edited src/indexer/parser.ts and tests/parser.test.ts</task-notification>\nnow update the docs`;
    expect(stripHarnessWrappers(raw)).toBe('now update the docs');
  });

  it('handles nested wrappers', () => {
    const raw = `<task-notification>done <system-reminder>remember to run tests</system-reminder></task-notification> ship it`;
    expect(stripHarnessWrappers(raw)).toBe('ship it');
  });

  it('multiline wrappers spanning many lines are removed whole', () => {
    const raw = ['<system-reminder>', 'line one', 'line two', '</system-reminder>', 'real question here'].join('\n');
    expect(stripHarnessWrappers(raw).trim()).toBe('real question here');
  });

  it('a truncated payload leaves no dangling tag behind', () => {
    expect(stripHarnessWrappers('<ide_opened_file> fix the keeper')).toBe('fix the keeper');
    expect(stripHarnessWrappers('fix the keeper </ide_selection>')).toBe('fix the keeper');
  });

  it('leaves user-pasted markup alone — over-stripping would drop real questions', () => {
    const raw = 'why does <div class="row"> break the layout? see <Foo /> too';
    expect(stripHarnessWrappers(raw)).toBe(raw);
  });

  it('every declared tag is actually stripped', () => {
    for (const tag of HARNESS_TAGS as string[]) {
      expect(stripHarnessWrappers(`<${tag}>noise</${tag}> ask`)).toBe('ask');
    }
  });

  it('fails open on non-string input', () => {
    expect(stripHarnessWrappers(undefined)).toBe('');
    expect(stripHarnessWrappers(null)).toBe('');
  });
});

describe('recallQuery', () => {
  it('strips BEFORE truncating, so a long wrapper cannot eat the query budget', () => {
    const noise = `<ide_selection>${'x '.repeat(1200)}</ide_selection>`;
    const raw = `${noise}\nwhy is the keeper not reaping?`;
    // Truncating first would leave nothing but telemetry.
    expect(raw.slice(0, 2000)).not.toContain('reaping');
    expect(recallQuery(raw, 2000)).toBe('why is the keeper not reaping?');
  });

  it('telemetry-only prompts yield an empty query, so the hook skips the search', () => {
    expect(recallQuery('<ide_opened_file>src/keeper.ts</ide_opened_file>', 2000)).toBe('');
    expect(recallQuery('', 2000)).toBe('');
  });

  it('still truncates genuinely long user text', () => {
    expect(recallQuery('a'.repeat(3000), 2000)).toHaveLength(2000);
  });
});
