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
