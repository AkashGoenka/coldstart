import { describe, it, expect, beforeAll } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { walkDirectory } from '../src/indexer/walker.js';
import { parseFile, buildFileId } from '../src/indexer/parser.js';
import { resolveImports } from '../src/indexer/resolvers/index.js';
import { buildGraph } from '../src/indexer/graph.js';
import { addRailsSyntheticEdges } from '../src/indexer/rails-synthetic.js';
import { buildFileDomains, isTestPath } from '../src/indexer/tokenize.js';
import type { CodebaseIndex, IndexedFile } from '../src/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ============================================================================
// Test Index Builder
// ============================================================================
async function buildRailsTestIndex(rootDir: string): Promise<CodebaseIndex> {
  const walkedFiles = await walkDirectory({ rootDir, excludes: [], includes: [] });
  const indexedFiles: IndexedFile[] = [];

  await Promise.all(
    walkedFiles.map(async (wf) => {
      try {
        const id = buildFileId(wf.relativePath);
        const parsed = await parseFile(wf.absolutePath, wf.language, id);
        if (!parsed) return;

        const file: IndexedFile = {
          id,
          path: wf.absolutePath,
          relativePath: wf.relativePath,
          language: wf.language,
          domainMap: buildFileDomains(wf.relativePath, parsed.exports),
          exports: parsed.exports,
          hasDefaultExport: parsed.hasDefaultExport,
          imports: parsed.imports,
          hash: parsed.hash,
          lineCount: parsed.lineCount,
          tokenEstimate: parsed.tokenEstimate,
          importedByCount: 0,
          transitiveImportedByCount: 0,
          isBarrel: false,
          isTestFile: isTestPath(wf.relativePath),
          symbols: parsed.symbols,
          reexportRatio: parsed.reexportRatio,
          constantReferences: parsed.constantReferences,
        };
        indexedFiles.push(file);
      } catch {
        // skip
      }
    }),
  );

  const { edges } = await resolveImports(indexedFiles, rootDir);
  const fullFileIdSet = new Set(indexedFiles.map(f => f.id));
  await addRailsSyntheticEdges(indexedFiles, edges, fullFileIdSet, rootDir);
  const nodeIds = indexedFiles.map(f => f.id);
  const { outEdges, inEdges } = buildGraph(nodeIds, edges);

  for (const file of indexedFiles) {
    file.importedByCount = inEdges.get(file.id)?.length ?? 0;
  }

  const filesMap = new Map<string, IndexedFile>(indexedFiles.map(f => [f.id, f]));
  return {
    rootDir,
    files: filesMap,
    outEdges,
    inEdges,
    allSymbolEdges: [],
  };
}

// ============================================================================
// Rails Mini Fixture Tests
// ============================================================================
describe('Rails extractor — association imports', () => {
  let index: CodebaseIndex;
  const FIXTURE_ROOT = join(__dirname, 'fixtures/rails-mini');

  beforeAll(async () => {
    index = await buildRailsTestIndex(FIXTURE_ROOT);
  });

  it('post.rb imports comment.rb via has_many :comments', async () => {
    const postId = 'app/models/post.rb';
    const postFile = index.files.get(postId);
    expect(postFile).toBeDefined();
    expect(postFile!.imports).toContainEqual('./comment');
  });

  it('post.rb imports user.rb via belongs_to :user', async () => {
    const postId = 'app/models/post.rb';
    const postFile = index.files.get(postId);
    expect(postFile).toBeDefined();
    expect(postFile!.imports).toContainEqual('./user');
  });

  it('comment.rb imports post.rb via belongs_to :post', async () => {
    const commentId = 'app/models/comment.rb';
    const commentFile = index.files.get(commentId);
    expect(commentFile).toBeDefined();
    expect(commentFile!.imports).toContainEqual('./post');
  });

  it('user.rb imports post.rb via has_many :posts', async () => {
    const userId = 'app/models/user.rb';
    const userFile = index.files.get(userId);
    expect(userFile).toBeDefined();
    expect(userFile!.imports).toContainEqual('./post');
  });

  it('category.rb imports itself via has_many :categories (ies pluralization)', async () => {
    const categoryId = 'app/models/category.rb';
    const categoryFile = index.files.get(categoryId);
    expect(categoryFile).toBeDefined();
    expect(categoryFile!.imports).toContainEqual('./category');
  });

  it('bookmark.rb imports ./status (not ./statu) — singularize must skip -us endings', async () => {
    const bookmarkFile = index.files.get('app/models/bookmark.rb');
    expect(bookmarkFile).toBeDefined();
    expect(bookmarkFile!.imports).toContainEqual('./status');
    expect(bookmarkFile!.imports).not.toContainEqual('./statu');
  });

  it('bookmark.rb does NOT emit imports from validates / before_action (callbacks aren\'t associations)', async () => {
    const bookmarkFile = index.files.get('app/models/bookmark.rb');
    expect(bookmarkFile).toBeDefined();
    expect(bookmarkFile!.imports).not.toContainEqual('./status_id');
    expect(bookmarkFile!.imports).not.toContainEqual('./user_id');
    expect(bookmarkFile!.imports).not.toContainEqual('./set_defaults');
  });
});

describe('Rails extractor — routes.rb controller edges', () => {
  let index: CodebaseIndex;
  const FIXTURE_ROOT = join(__dirname, 'fixtures/rails-mini');

  beforeAll(async () => {
    index = await buildRailsTestIndex(FIXTURE_ROOT);
  });

  it('config/routes.rb imports posts_controller via resources :posts', async () => {
    const routesId = 'config/routes.rb';
    const routesFile = index.files.get(routesId);
    expect(routesFile).toBeDefined();
    expect(routesFile!.imports.some(i => i.includes('posts_controller'))).toBe(true);
  });

  it('config/routes.rb imports admin_controller via get to: "admin#index"', async () => {
    const routesId = 'config/routes.rb';
    const routesFile = index.files.get(routesId);
    expect(routesFile).toBeDefined();
    expect(routesFile!.imports.some(i => i.includes('admin_controller'))).toBe(true);
  });
});

describe('Rails extractor — controller to view edges', () => {
  let index: CodebaseIndex;
  const FIXTURE_ROOT = join(__dirname, 'fixtures/rails-mini');

  beforeAll(async () => {
    index = await buildRailsTestIndex(FIXTURE_ROOT);
  });

  it('posts_controller.rb has outgoing edge to posts/index.rb', async () => {
    const controllerId = 'app/controllers/posts_controller.rb';
    const viewId = 'app/views/posts/index.rb';
    const outgoing = index.outEdges.get(controllerId) ?? [];
    expect(outgoing).toContain(viewId);
  });

  it('posts_controller.rb has outgoing edge to posts/show.rb', async () => {
    const controllerId = 'app/controllers/posts_controller.rb';
    const viewId = 'app/views/posts/show.rb';
    const outgoing = index.outEdges.get(controllerId) ?? [];
    expect(outgoing).toContain(viewId);
  });

  it('posts/index.rb has incoming edge from posts_controller.rb', async () => {
    const controllerId = 'app/controllers/posts_controller.rb';
    const viewId = 'app/views/posts/index.rb';
    const incoming = index.inEdges.get(viewId) ?? [];
    expect(incoming).toContain(controllerId);
  });

  it('posts/show.rb has incoming edge from posts_controller.rb', async () => {
    const controllerId = 'app/controllers/posts_controller.rb';
    const viewId = 'app/views/posts/show.rb';
    const incoming = index.inEdges.get(viewId) ?? [];
    expect(incoming).toContain(controllerId);
  });
});

describe('Rails extractor — nesting-aware constant autoload', () => {
  let index: CodebaseIndex;
  const FIXTURE_ROOT = join(__dirname, 'fixtures/rails-mini');

  beforeAll(async () => {
    index = await buildRailsTestIndex(FIXTURE_ROOT);
  });

  it('resolves bare `Invite` inside module Members to Members::Invite (not top-level)', () => {
    const fromId = 'app/services/members/invite_processor.rb';
    const namespaced = 'app/models/members/invite.rb';
    const topLevel = 'app/models/invite.rb';
    const outgoing = index.outEdges.get(fromId) ?? [];
    expect(outgoing).toContain(namespaced);
    expect(outgoing).not.toContain(topLevel);
  });
});

describe('Rails extractor — non-Rails regression test', () => {
  let index: CodebaseIndex;
  const FIXTURE_ROOT = join(__dirname, 'fixtures/plain-ruby');

  beforeAll(async () => {
    index = await buildRailsTestIndex(FIXTURE_ROOT);
  });

  it('lib/foo.rb does NOT import anything for has_many (non-Rails context)', async () => {
    const fooId = 'lib/foo.rb';
    const fooFile = index.files.get(fooId);
    expect(fooFile).toBeDefined();
    expect(fooFile!.imports).not.toContainEqual('./bar');
    expect(fooFile!.imports).not.toContain('./bars');
  });
});
