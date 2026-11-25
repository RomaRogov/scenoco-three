/**
 * The game's tree as the renderer has it, through the host: a pixi 3D world hangs from its `View3D`,
 * outside its own `children` — so the editor never walks a node's own `parent` or `children`.
 */
import type { EditHost } from '@scenoco-three/core';

type Node = Parameters<EditHost['childrenOf']>[0];

/** `node` and everything under it, depth first. */
export function walk(host: EditHost, node: Node, visit: (node: Node) => void): void {
  visit(node);
  for (const child of host.childrenOf(node)) walk(host, child, visit);
}

/** Whether `node` is `root` or under it. */
export function within(host: EditHost, node: Node, root: Node): boolean {
  for (let n: Node | null = node; n; n = host.parentOf(n)) if (n === root) return true;
  return false;
}
