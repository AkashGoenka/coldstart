/**
 * Tree-sitter node helpers shared across the language extractors.
 *
 * Every grammar package ships its own node class, so `TSNode` is `any` — these
 * helpers only touch the common `namedChildren` / `type` surface that every
 * tree-sitter node exposes.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TSNode = any;

export function childrenOfType(node: TSNode, type: string): TSNode[] {
  return node.namedChildren.filter((c: TSNode) => c.type === type);
}

export function firstChildOfType(node: TSNode, type: string): TSNode | null {
  return node.namedChildren.find((c: TSNode) => c.type === type) ?? null;
}

export function firstChildOfTypes(node: TSNode, types: string[]): TSNode | null {
  return node.namedChildren.find((c: TSNode) => types.includes(c.type)) ?? null;
}

/**
 * Identity-compare two tree-sitter nodes by their stable numeric `id`, NOT by
 * object identity (`===`). node-tree-sitter caches node wrappers so `a === b`
 * holds for the same underlying node, but web-tree-sitter (WASM) mints a fresh
 * wrapper on every accessor call — so `node === node.parent.namedChildren[0]`
 * is false there even when they are the same node. `.id` is stable and equal
 * across wrappers in BOTH runtimes, so comparing it keeps extraction identical
 * regardless of engine. (See the WASM migration work: object-identity checks
 * were the sole source of native-vs-WASM extraction divergence.)
 */
export function sameNode(a: TSNode | null | undefined, b: TSNode | null | undefined): boolean {
  return a != null && b != null && a.id === b.id;
}
