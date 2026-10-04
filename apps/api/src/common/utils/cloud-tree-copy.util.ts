import { createHash } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import type { StorageService } from '../../infra/storage/storage.service'

/** 已复制文件的一条清单记录（站点快照 manifest 与展示应用检查点共用） */
export interface CopiedFileEntry {
  /** 源 `cloud_file` 行 id（审计追溯用；快照本身不依赖它） */
  fileId: string
  /** 内容 sha256（物理去重与长缓存的输入） */
  contentHash: string
  size: number
  mime: string | null
}

export interface CopyCloudTreeOptions {
  /** 属主（云盘按 userId 隔离） */
  userId: bigint
  /** 起始目录节点 id */
  rootFolderId: bigint
  /** 快照内前缀（相对路径），如 `disp/12`；缺省 = 直接铺在 `destDir` 下 */
  prefix?: string
  /** 目标目录（相对存储根；调用方用 `releaseDirOf` / `dispReleaseDirOf` 得到） */
  destDir: string
  /** 遍历深度上限（防环） */
  maxDepth: number
  /** 顶层需要排除的目录名（站点快照排除 `disp/`，因为展示应用改从各自工作区聚合） */
  excludeTop?: ReadonlySet<string>
  /** 非致命情况（DB 有行但盘无文件）的告警出口 */
  warn?: (message: string) => void
}

/**
 * 把云盘目录子树复制成一份**平面文件快照**（BFS；只复制**文件**，目录不入清单）。
 *
 * 站点发布（P19 T160）与展示应用检查点（P20 T167）**共用**：两者都是
 * 「工作区 → 不可变快照」，差别只在目标目录、前缀与是否排除顶层目录。
 *
 * 抽公共实现而非各写一份：同一片工作区被两条路径读出不同结果，是排查成本极高的那类缺陷
 * （P17 就因过滤语法两份实现差点出现「管理侧放行、运行期拒绝」的裂缝）。调用方各自决定
 * 清单条目的落库 / 落盘形态。
 *
 * 缺物理文件（DB 有行、盘无文件）→ 跳过并告警：快照宁可缺一个坏文件，也不因单文件缺失
 * 让整次发布失败。
 */
export async function copyCloudTree(
  prisma: PrismaClient,
  storage: StorageService,
  options: CopyCloudTreeOptions,
): Promise<{ entries: Record<string, CopiedFileEntry>; fileCount: number; totalBytes: number }> {
  const { userId, rootFolderId, prefix = '', destDir, maxDepth, excludeTop, warn } = options
  const entries: Record<string, CopiedFileEntry> = {}
  let fileCount = 0
  let totalBytes = 0
  const queue: Array<{ folderId: bigint; prefix: string; depth: number }> = [
    { folderId: rootFolderId, prefix, depth: 0 },
  ]

  while (queue.length > 0) {
    const node = queue.shift()
    if (!node || node.depth > maxDepth) continue
    const children = await prisma.cloudFile.findMany({
      where: { userId, parentId: node.folderId, deletedAt: null },
      select: { id: true, name: true, isDir: true, size: true, mime: true, storageName: true },
      orderBy: [{ isDir: 'desc' }, { name: 'asc' }],
    })
    for (const child of children) {
      const relPath = node.prefix ? `${node.prefix}/${child.name}` : child.name
      if (child.isDir === 1) {
        if (node.depth === 0 && excludeTop?.has(child.name)) continue
        queue.push({ folderId: child.id, prefix: relPath, depth: node.depth + 1 })
        continue
      }
      if (!child.storageName) {
        warn?.(`快照跳过无物理文件的记录：${relPath}（fileId=${child.id.toString()}）`)
        continue
      }
      const exists = await storage.stat(child.storageName)
      if (!exists) {
        warn?.(`快照跳过物理文件缺失的记录：${relPath}（fileId=${child.id.toString()}）`)
        continue
      }
      await storage.copyStorageInto(child.storageName, destDir, relPath)
      entries[relPath] = {
        fileId: child.id.toString(),
        contentHash: await hashStorageFile(storage, child.storageName),
        size: exists.size,
        mime: child.mime,
      }
      fileCount += 1
      totalBytes += exists.size
    }
  }
  return { entries, fileCount, totalBytes }
}

/** 计算正式区文件内容 sha256（流式，禁整文件进内存） */
export function hashStorageFile(storage: StorageService, storageName: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = storage.createReadStream(storageName)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}
