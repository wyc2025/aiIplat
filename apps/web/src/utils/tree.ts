/** 平铺列表转树（dept/menu 通用）。约定 id/parentId 为字符串，parentId '0' 为根 */
export interface TreeNode {
  id: string
  parentId: string
  children?: TreeNode[]
}

/**
 * 泛型约束只需 id/parentId（可选 children），返回类型在 T 基础上补 children。
 * 入参可以是任意含 id/parentId 的实体（MenuItem、DeptItem 等），不必有索引签名。
 */
export function listToTree<T extends { id: string; parentId: string }>(
  list: T[],
): Array<T & { children: Array<T & { children: never[] }> }> {
  type Node = T & { children: Node[] }
  const map = new Map<string, Node>()
  const roots: Node[] = []
  for (const item of list) {
    map.set(item.id, { ...item, children: [] } as Node)
  }
  for (const item of list) {
    const node = map.get(item.id)!
    if (item.parentId === '0' || !map.has(item.parentId)) {
      roots.push(node)
    } else {
      map.get(item.parentId)!.children.push(node)
    }
  }
  return roots as Array<T & { children: Array<T & { children: never[] }> }>
}
