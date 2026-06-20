/**
 * Tests for the content-token link channel: extraction (shape gate,
 * provenance, comment/vendored exclusion), postings (df window), link
 * derivation gates (cross-directory, edge redundancy, strength, query-stem,
 * triangle dedupe, caps), and GO/GS rendering.
 */
import { describe, it, expect } from 'vitest';
import {
  extractContentTokens,
  buildContentTokenPostings,
  deriveInPageTokenLinks,
  deriveRelatedFiles,
  deriveNameEchoFiles,
  isShapedToken,
  isVendoredAssetPath,
  TOKEN_IN_CODE,
  TOKEN_IN_STRING,
  TOKEN_LINKS_PER_PAGE,
} from '../src/indexer/content-tokens.js';
import { handleFind, handleGetStructure } from '../src/server/tools.js';
import type { CodebaseIndex, IndexedFile, Edge } from '../src/types.js';

// ============================================================================
// Synthetic index builder
// ============================================================================
type FileSpec = Partial<IndexedFile> & { id: string };

function makeFile(spec: FileSpec): IndexedFile {
  return {
    id: spec.id,
    path: spec.path ?? '/nonexistent/' + spec.id,
    relativePath: spec.id,
    language: spec.language ?? 'python',
    domainMap: spec.domainMap ?? {},
    exports: spec.exports ?? [],
    hasDefaultExport: false,
    imports: spec.imports ?? [],
    hash: 'h',
    lineCount: 10,
    tokenEstimate: 10,
    importedByCount: 0,
    transitiveImportedByCount: 0,
    isBarrel: spec.isBarrel ?? false,
    isTestFile: spec.isTestFile ?? false,
    symbols: spec.symbols ?? [],
    contentTokens: spec.contentTokens,
  };
}

function makeIndex(specs: FileSpec[], edges: Edge[] = []): CodebaseIndex {
  const files = new Map(specs.map(s => [s.id, makeFile(s)]));
  const outEdges = new Map<string, string[]>();
  const inEdges = new Map<string, string[]>();
  for (const id of files.keys()) {
    outEdges.set(id, []);
    inEdges.set(id, []);
  }
  for (const e of edges) {
    outEdges.get(e.from)!.push(e.to);
    inEdges.get(e.to)!.push(e.from);
  }
  const tokenDocFreq = new Map<string, number>();
  for (const f of files.values()) {
    for (const t of Object.keys(f.domainMap)) {
      tokenDocFreq.set(t, (tokenDocFreq.get(t) ?? 0) + 1);
    }
  }
  return {
    rootDir: '/',
    files,
    edges,
    symbolEdges: [],
    outEdges,
    inEdges,
    tokenDocFreq,
    contentTokenPostings: buildContentTokenPostings(files.values()),
    indexedAt: Date.now(),
    gitHead: '',
  };
}

// ============================================================================
// Shape gate
// ============================================================================
describe('isShapedToken', () => {
  it('accepts multi-word identifier shapes, case preserved', () => {
    expect(isShapedToken('limit_choices_to')).toBe(true);
    expect(isShapedToken('source_identifier__isnull')).toBe(true); // double underscore
    expect(isShapedToken('jwksUri')).toBe(true);
    expect(isShapedToken('UserPreference')).toBe(true);
    expect(isShapedToken('SEARCH_ITEMS_PER_PAGE')).toBe(true);
  });

  it('rejects prose and single words (the measured noise classes)', () => {
    expect(isShapedToken('preference')).toBe(false);
    expect(isShapedToken('ideally')).toBe(false);
    expect(isShapedToken('index')).toBe(false);
    expect(isShapedToken('Account')).toBe(false); // single-word Pascal
    expect(isShapedToken('ABCDEF')).toBe(false); // single-word caps
    expect(isShapedToken('a_b')).toBe(false); // too short
    expect(isShapedToken('_private_thing')).toBe(false); // leading underscore
  });
});

// ============================================================================
// Extraction
// ============================================================================
describe('extractContentTokens', () => {
  it('tags string-literal occurrences and code occurrences with provenance bits', () => {
    const tokens = extractContentTokens(
      `FILENAME_GENERATOR = "arches.app.utils.storage_filename_generator"\nresult = limit_choices_to\n`,
      'settings.py',
    )!;
    expect(tokens['FILENAME_GENERATOR'] & TOKEN_IN_CODE).toBeTruthy();
    expect(tokens['storage_filename_generator'] & TOKEN_IN_STRING).toBeTruthy();
    expect(tokens['storage_filename_generator'] & TOKEN_IN_CODE).toBeFalsy();
    expect(tokens['limit_choices_to']).toBe(TOKEN_IN_CODE);
  });

  it('drops comment-derived tokens (measured noise class)', () => {
    const tokens = extractContentTokens(
      `# this mentions user_preference in a comment\nx = 1  // and todo_marker here\nreal_token_here = 2\n`,
      'a.py',
    )!;
    expect(tokens['user_preference']).toBeUndefined();
    expect(tokens['todo_marker']).toBeUndefined();
    expect(tokens['real_token_here']).toBeDefined();
  });

  it('still captures string-literal tokens on commented lines before the marker', () => {
    const tokens = extractContentTokens(`path = 'term_filter.py'  # registers component\n`, 'a.py')!;
    expect(tokens['term_filter']).toBeDefined();
  });

  it('returns undefined for vendored/minified assets and markdown', () => {
    expect(extractContentTokens('var jquery_thing = 1;', 'media/js/jquery.min.js')).toBeUndefined();
    expect(extractContentTokens('shared_token_here', 'docs/notes.md')).toBeUndefined();
    expect(isVendoredAssetPath('app/vendor/lib.js')).toBe(true);
    expect(isVendoredAssetPath('app/models/models.py')).toBe(false);
  });
});

// ============================================================================
// Postings — df window
// ============================================================================
describe('buildContentTokenPostings', () => {
  it('keeps only tokens with df in [2,5], excluding test files and barrels', () => {
    const specs: FileSpec[] = [
      { id: 'a/one.py', contentTokens: { shared_pair: 1, lonely_token: 1, common_token: 1 } },
      { id: 'b/two.py', contentTokens: { shared_pair: 1, common_token: 1 } },
      { id: 'tests/t.py', isTestFile: true, contentTokens: { shared_pair: 1 } },
    ];
    for (let i = 0; i < 6; i++) {
      specs.push({ id: `c/f${i}.py`, contentTokens: { common_token: 1 } });
    }
    const postings = buildContentTokenPostings(specs.map(makeFile));
    expect(postings.get('shared_pair')).toEqual(['a/one.py', 'b/two.py']); // test file excluded
    expect(postings.has('lonely_token')).toBe(false); // df=1
    expect(postings.has('common_token')).toBe(false); // df=8 > 5
  });
});

// ============================================================================
// In-page link derivation — the gates
// ============================================================================
describe('deriveInPageTokenLinks', () => {
  const goldPair: FileSpec[] = [
    {
      id: 'app/models/models.py',
      contentTokens: { limit_choices_to: TOKEN_IN_CODE, source_identifier__isnull: TOKEN_IN_STRING },
    },
    {
      id: 'app/models/migrations/11857_fix.py',
      contentTokens: { limit_choices_to: TOKEN_IN_STRING, source_identifier__isnull: TOKEN_IN_STRING },
    },
  ];

  it('links cross-directory files sharing rare tokens (the q16 shape)', () => {
    const index = makeIndex(goldPair);
    const links = deriveInPageTokenLinks(['app/models/models.py', 'app/models/migrations/11857_fix.py'], index);
    expect(links).toHaveLength(1);
    expect(links[0].b).toBe('app/models/migrations/11857_fix.py');
    expect(links[0].tokens).toContain('limit_choices_to');
    expect(links[0].hasStringProvenance).toBe(true);
  });

  it('suppresses same-directory pairs (boilerplate twins)', () => {
    const index = makeIndex([
      { id: 'm/11848_a.py', contentTokens: { spatial_view_thing: 1, other_shared_tok: 1 } },
      { id: 'm/11857_b.py', contentTokens: { spatial_view_thing: 1, other_shared_tok: 1 } },
    ]);
    expect(deriveInPageTokenLinks(['m/11848_a.py', 'm/11857_b.py'], index)).toHaveLength(0);
  });

  it('suppresses pairs already connected by an import edge (rendered as ← imported by)', () => {
    const index = makeIndex(
      [
        { id: 'a/x.py', contentTokens: { shared_tok_one: 1, shared_tok_two: 1 } },
        { id: 'b/y.py', contentTokens: { shared_tok_one: 1, shared_tok_two: 1 } },
      ],
      [{ from: 'b/y.py', to: 'a/x.py', type: 'import', specifier: 'x' }],
    );
    expect(deriveInPageTokenLinks(['a/x.py', 'b/y.py'], index)).toHaveLength(0);
  });

  it('kills weak 2-word single-code-token pairs but keeps single string-literal tokens', () => {
    // 2-word generic (the measured weak-single noise class: new_ids, child_node)
    const weak = makeIndex([
      { id: 'a/x.py', contentTokens: { child_node: TOKEN_IN_CODE } },
      { id: 'b/y.py', contentTokens: { child_node: TOKEN_IN_CODE } },
    ]);
    expect(deriveInPageTokenLinks(['a/x.py', 'b/y.py'], weak)).toHaveLength(0);

    const stringRef = makeIndex([
      { id: 'a/x.py', contentTokens: { child_node: TOKEN_IN_STRING } },
      { id: 'b/y.py', contentTokens: { child_node: TOKEN_IN_CODE } },
    ]);
    expect(deriveInPageTokenLinks(['a/x.py', 'b/y.py'], stringRef)).toHaveLength(1);
  });

  it('admits a single CODE token when ultra-rare (df ≤ 3) and ≥3 words — the q16 gold shape', () => {
    // limit_choices_to: df 3, 3 words, code provenance on both sides
    const index = makeIndex([
      { id: 'app/models/models.py', contentTokens: { limit_choices_to: TOKEN_IN_CODE } },
      { id: 'app/migrations/11857_fix.py', contentTokens: { limit_choices_to: TOKEN_IN_CODE } },
      { id: 'app/other/10516_rename.py', contentTokens: { limit_choices_to: TOKEN_IN_CODE } },
    ]);
    const links = deriveInPageTokenLinks(['app/models/models.py', 'app/migrations/11857_fix.py'], index);
    expect(links).toHaveLength(1);
    expect(links[0].tokens).toEqual(['limit_choices_to']);
  });

  it('suppresses tokens containing a query stem (they link by construction)', () => {
    const index = makeIndex([
      { id: 'a/x.py', contentTokens: { spatial_view_helper: TOKEN_IN_STRING } },
      { id: 'b/y.py', contentTokens: { spatial_view_helper: TOKEN_IN_STRING } },
    ]);
    expect(deriveInPageTokenLinks(['a/x.py', 'b/y.py'], index, ['spatial'])).toHaveLength(0);
    expect(deriveInPageTokenLinks(['a/x.py', 'b/y.py'], index, ['unrelated'])).toHaveLength(1);
  });

  it('drops the triangle third side when implied by two stronger links', () => {
    const index = makeIndex([
      { id: 'a/x.py', contentTokens: { tok_alpha_beta: TOKEN_IN_STRING, tok_gamma_delta: TOKEN_IN_STRING } },
      { id: 'b/y.py', contentTokens: { tok_alpha_beta: TOKEN_IN_STRING, tok_gamma_delta: TOKEN_IN_STRING, tok_extra_one: TOKEN_IN_STRING } },
      { id: 'c/z.py', contentTokens: { tok_alpha_beta: TOKEN_IN_STRING, tok_gamma_delta: TOKEN_IN_STRING, tok_extra_one: TOKEN_IN_STRING } },
    ]);
    const links = deriveInPageTokenLinks(['a/x.py', 'b/y.py', 'c/z.py'], index);
    // b–c is strongest (3 tokens); a–b and a–c carry subsets → one of them
    // survives as second link, the third side is implied and dropped.
    expect(links).toHaveLength(2);
  });

  it('caps links per page', () => {
    const specs: FileSpec[] = [];
    for (let i = 0; i < 5; i++) {
      specs.push({
        id: `d${i}/f${i}.py`,
        contentTokens: { [`pair_token_${i}_a`]: TOKEN_IN_STRING, [`pair_token_${i}_b`]: TOKEN_IN_STRING },
      });
      specs.push({
        id: `e${i}/g${i}.py`,
        contentTokens: { [`pair_token_${i}_a`]: TOKEN_IN_STRING, [`pair_token_${i}_b`]: TOKEN_IN_STRING },
      });
    }
    const index = makeIndex(specs);
    const links = deriveInPageTokenLinks(specs.map(s => s.id), index);
    expect(links.length).toBeLessThanOrEqual(TOKEN_LINKS_PER_PAGE);
  });
});

// ============================================================================
// GS-side related files + name-echo
// ============================================================================
describe('deriveRelatedFiles', () => {
  it('finds the migration from the model and excludes rendered neighbors', () => {
    const index = makeIndex([
      { id: 'app/models/models.py', contentTokens: { limit_choices_to: TOKEN_IN_CODE, source_identifier__isnull: TOKEN_IN_CODE } },
      { id: 'app/models/migrations/11857_fix.py', contentTokens: { limit_choices_to: TOKEN_IN_STRING, source_identifier__isnull: TOKEN_IN_STRING } },
      { id: 'app/views/spatialview.py', contentTokens: { limit_choices_to: TOKEN_IN_CODE, source_identifier__isnull: TOKEN_IN_CODE } },
    ]);
    const src = index.files.get('app/models/models.py')!.contentTokens!;
    const related = deriveRelatedFiles('app/models/models.py', src, index, new Set(['app/views/spatialview.py']));
    expect(related).toHaveLength(1);
    expect(related[0].fileId).toBe('app/models/migrations/11857_fix.py');
    expect(related[0].tokens).toEqual(
      expect.arrayContaining(['limit_choices_to', 'source_identifier__isnull']),
    );
  });
});

describe('deriveNameEchoFiles', () => {
  it('matches compound filenames separator-insensitively (UserPreference → userpreference.py)', () => {
    const index = makeIndex([
      { id: 'app/views/api/userpreference.py' },
      { id: 'app/models/models.py' },
    ]);
    const hits = deriveNameEchoFiles(['UserPreference'], index, new Set());
    expect(hits).toHaveLength(1);
    expect(hits[0].fileId).toBe('app/views/api/userpreference.py');
    expect(hits[0].viaName).toBe('UserPreference');
  });

  it('df-gates common terms (skips terms matching too many filenames)', () => {
    const specs: FileSpec[] = [];
    for (let i = 0; i < 8; i++) specs.push({ id: `r${i}/resource_${i}.py` });
    const index = makeIndex(specs);
    expect(deriveNameEchoFiles(['resource'], index, new Set())).toHaveLength(0);
  });
});

// ============================================================================
// End-to-end rendering
// ============================================================================
describe('GS Related section rendering', () => {
  it('renders Related with shared tokens in the full view', () => {
    const index = makeIndex([
      { id: 'app/models/models.py', contentTokens: { limit_choices_to: TOKEN_IN_CODE, source_identifier__isnull: TOKEN_IN_CODE } },
      { id: 'app/migrations/11857_fix.py', contentTokens: { limit_choices_to: TOKEN_IN_STRING, source_identifier__isnull: TOKEN_IN_STRING } },
    ]);
    const res = handleGetStructure(index, { file_path: 'app/models/models.py' }) as { __rawText: string };
    expect(res.__rawText).toContain('Related (shares rare tokens, no import edge');
    expect(res.__rawText).toContain('app/migrations/11857_fix.py — shares `limit_choices_to`');
  });

  it('omits Related when an import edge already connects the pair', () => {
    const index = makeIndex(
      [
        { id: 'app/models/models.py', contentTokens: { limit_choices_to: TOKEN_IN_CODE, source_identifier__isnull: TOKEN_IN_CODE } },
        { id: 'app/migrations/11857_fix.py', contentTokens: { limit_choices_to: TOKEN_IN_STRING, source_identifier__isnull: TOKEN_IN_STRING } },
      ],
      [{ from: 'app/migrations/11857_fix.py', to: 'app/models/models.py', type: 'import', specifier: 'models' }],
    );
    const res = handleGetStructure(index, { file_path: 'app/models/models.py' }) as { __rawText: string };
    expect(res.__rawText).not.toContain('Related (');
  });

  it('lists files referencing the match term in body content, repo-wide (the admin.py + cross-language case)', () => {
    // admin.py imports models.py and references SpatialView via attribute
    // access — no call edge, filename doesn't match. viewer.js references the
    // symbol WITHOUT importing the file (JS↔Python, no possible edge) — the
    // repo-wide scan must surface both; a file with no body reference must
    // not appear. The section must also close with the exhaustiveness line
    // (the q16 run-3 tail happened because nothing said the list was complete).
    const index = makeIndex(
      [
        { id: 'app/models/models.py', symbols: [{ id: 's1', name: 'SpatialView', kind: 'class', startLine: 1, endLine: 5, isExported: true, implementsNames: [] }] },
        { id: 'admin.py', contentTokens: { SpatialView: TOKEN_IN_CODE } },
        { id: 'app/media/js/viewer.js', contentTokens: { SpatialView: TOKEN_IN_CODE } },
        { id: 'app/views/unrelated.py', contentTokens: { other_token_here: TOKEN_IN_CODE } },
      ],
      [
        { from: 'admin.py', to: 'app/models/models.py', type: 'import', specifier: 'models' },
        { from: 'app/views/unrelated.py', to: 'app/models/models.py', type: 'import', specifier: 'models' },
      ],
    );
    const res = handleGetStructure(index, {
      file_path: 'app/models/models.py',
      match: 'spatialview', // lowercase, the form real runs use
    }) as { __rawText: string };
    expect(res.__rawText).toContain('Files referencing "spatialview" in content (2)');
    expect(res.__rawText).toContain('admin.py');
    expect(res.__rawText).toContain('app/media/js/viewer.js');
    expect(res.__rawText).not.toContain('unrelated.py');
    expect(res.__rawText).toContain('This list is exhaustive over indexed file content');
  });

  it('omits the body-reference section when nothing matches (never a misleading 0)', () => {
    const index = makeIndex(
      [
        { id: 'app/models/models.py', symbols: [{ id: 's1', name: 'SpatialView', kind: 'class', startLine: 1, endLine: 5, isExported: true, implementsNames: [] }] },
        { id: 'app/views/unrelated.py', contentTokens: { other_token_here: TOKEN_IN_CODE } },
      ],
      [{ from: 'app/views/unrelated.py', to: 'app/models/models.py', type: 'import', specifier: 'models' }],
    );
    const res = handleGetStructure(index, {
      file_path: 'app/models/models.py',
      match: 'spatialview',
    }) as { __rawText: string };
    expect(res.__rawText).not.toContain('referencing "spatialview" in content');
  });

  it('adds name-echo files for match terms', () => {
    const index = makeIndex([
      { id: 'app/models/models.py', contentTokens: { some_token_here: TOKEN_IN_CODE } },
      { id: 'app/views/api/userpreference.py' },
    ]);
    const res = handleGetStructure(index, {
      file_path: 'app/models/models.py',
      match: 'UserPreference',
    }) as { __rawText: string };
    expect(res.__rawText).toContain('app/views/api/userpreference.py — filename matches "UserPreference"');
  });
});

