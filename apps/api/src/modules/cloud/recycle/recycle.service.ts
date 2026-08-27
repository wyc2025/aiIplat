import { Injectable, Logger } from '@nestjs/common'
import { ErrorCode } from '../../../common/constants/error-code'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import { StorageService } from '../../../infra/storage/storage.service'
import { FileService, MAX_CHILDREN } from '../file/file.service'
import type { RecycleListQueryDto } from './dto/recycle.dto'

/** 回收站：顶层被删项查询（R2 算法）/ 只读浏览 / 还原（R5）/ 彻底删除（递归子树 + 连带删分享 + used 回扣 R3）/ 清空 */
@Injectable()
export class RecycleService {
  private readonly logger = new Logger(RecycleService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly fileService: FileService,
  ) {}

  /**
   * 回收站列表：
   * - 无 parentId → 顶层被删项（R2 算法，§13.4 禁 JOIN 应用层过滤）
   * - 带 parentId → 只读浏览该被删文件夹内容（前置校验目标处于已删子树内）
   */
  async list(userId: bigint, query: RecycleListQueryDto) {
    if (query.parentId == null) {
      const topLevel = await this.findTopLevelDeleted(userId)
      const list = topLevel.map((f) => this.toItem(f))
      return { list }
    }

    // 只读浏览：前置校验目标自身已删，或其任一祖先已删（即处于 deleted 子树内）
    const targetId = BigInt(query.parentId)
    const target = await this.prisma.cloudFile.findFirst({ where: { id: targetId, userId } })
    if (!target) {
      throw new BusinessException(ErrorCode.CloudRecycleNotFound, '回收站记录不存在')
    }
    if (!(await this.isInDeletedSubtree(target))) {
      throw new BusinessException(ErrorCode.CloudRecycleNotFound, '回收站记录不存在')
    }

    const children = await this.prisma.cloudFile.findMany({
      where: { userId, parentId: targetId, deletedAt: null },
    })
    const dirs = children
      .filter((f) => f.isDir === 1)
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
    const files = children
      .filter((f) => f.isDir === 0)
      .sort((a, b) => b.updateTime.getTime() - a.updateTime.getTime())
    return { list: [...dirs, ...files].map((f) => this.toItem(f)) }
  }

  /** 回收站面包屑链：根固定为「回收站」，后续为从被删项向上到其直接子级（自身必为 deleted 根） */
  async path(userId: bigint, id: bigint) {
    // 根（回收站本身）
    if (id === BigInt(0)) return [{ id: BigInt(0), name: '回收站' }]

    const target = await this.prisma.cloudFile.findFirst({ where: { id, userId } })
    if (!target || !(await this.isInDeletedSubtree(target))) {
      throw new BusinessException(ErrorCode.CloudRecycleNotFound, '回收站记录不存在')
    }

    // 上溯到"顶层被删项"（自身 deletedAt 非空的最高祖先），链顺序从回收站根 → … → 当前
    // 先反向收集（当前 → 上溯到 deleted 根），再反转
    const upward: Array<{ id: bigint; name: string }> = [{ id: target.id, name: target.name }]
    let current = target
    while (current.deletedAt === null && current.parentId !== BigInt(0)) {
      const parent = await this.prisma.cloudFile.findFirst({
        where: { id: current.parentId, userId },
      })
      if (!parent) break
      upward.push({ id: parent.id, name: parent.name })
      current = parent
    }
    upward.reverse()
    return [{ id: BigInt(0), name: '回收站' }, ...upward]
  }

  /**
   * 还原（R5）：只清自身 deleted_at；
   * 父目录存在且未删 → 还原原位；否则 → parent_id=0 落根目录（响应 message 说明）；
   * 落位前同名判定，冲突自动"(1)"。
   */
  async restore(userId: bigint, id: bigint) {
    const target = await this.prisma.cloudFile.findFirst({
      where: { id, userId, deletedAt: { not: null } },
    })
    if (!target) {
      throw new BusinessException(ErrorCode.CloudRecycleNotFound, '回收站记录不存在')
    }

    // 确定落位父目录（R5）
    let parentId = target.parentId
    let location = '原位置'
    if (parentId !== BigInt(0)) {
      const parent = await this.prisma.cloudFile.findFirst({
        where: { id: parentId, userId, deletedAt: null },
      })
      if (!parent) {
        parentId = BigInt(0)
        location = '根目录'
      }
    }

    // 落位前同名判定（排除回收站项，R4）：冲突自动 "(1)"
    const name = await this.fileService.resolveNameConflict(userId, parentId, target.name)

    await this.prisma.cloudFile.update({
      where: { id },
      data: { deletedAt: null, parentId, name },
    })

    return {
      id: id.toString(),
      name,
      location,
      message: parentId === BigInt(0) ? `已还原到根目录` : `已还原到原位置`,
    }
  }

  /**
   * 彻底删除（R3/R8，§13.4）：BFS 收集整棵子树（自身 + 全部后代）→ 连带删分享 →
   * 删物理文件 → 删 DB 行 → used 回扣 Σ文件 size（不小于 0 兜底）。
   */
  async purge(userId: bigint, id: bigint) {
    const root = await this.prisma.cloudFile.findFirst({
      where: { id, userId, deletedAt: { not: null } },
    })
    if (!root) {
      throw new BusinessException(ErrorCode.CloudRecycleNotFound, '回收站记录不存在')
    }
    const stats = await this.purgeSubtree(userId, [root])
    return { success: true, removedFiles: stats.files, reclaimedBytes: Number(stats.bytes) }
  }

  /** 清空回收站：对该用户全部顶层被删项执行同一递归逻辑 */
  async clear(userId: bigint) {
    const topLevel = await this.findTopLevelDeleted(userId)
    let files = 0
    let bytes = BigInt(0)
    for (const item of topLevel) {
      const stats = await this.purgeSubtree(userId, [item])
      files += stats.files
      bytes += stats.bytes
    }
    return { success: true, removedFiles: files, reclaimedBytes: Number(bytes) }
  }

  // ==================== 私有方法 ====================

  /**
   * 顶层被删项（R2 算法，§13.4 禁 JOIN）：
   * 自身 deleted_at 非空 且 沿 parent_id 上溯无 deleted 祖先。
   * 实现：查该用户全部 deleted 项 → 集合内比对祖先；祖先不在集合时补查父行 deleted_at。
   */
  private async findTopLevelDeleted(userId: bigint) {
    const deleted = await this.prisma.cloudFile.findMany({
      where: { userId, deletedAt: { not: null } },
    })
    if (deleted.length === 0) return []

    const deletedSet = new Set(deleted.map((f) => f.id.toString()))
    const result: typeof deleted = []
    for (const item of deleted) {
      let hasDeletedAncestor = false
      let cursor = item.parentId
      // 上溯最多 MAX_DEPTH 层防环（目录深度上限即 10 层）
      for (let depth = 0; depth < MAX_CHILDREN && cursor !== BigInt(0); depth++) {
        if (deletedSet.has(cursor.toString())) {
          hasDeletedAncestor = true
          break
        }
        // 祖先不在 deleted 集合：补查父行确认是否 deleted
        const parent = await this.prisma.cloudFile.findFirst({
          where: { id: cursor, userId },
          select: { id: true, parentId: true, deletedAt: true },
        })
        if (!parent) break
        if (parent.deletedAt !== null) {
          hasDeletedAncestor = true
          break
        }
        cursor = parent.parentId
      }
      if (!hasDeletedAncestor) result.push(item)
    }
    // 按删除时间倒序（回收站列表展示）
    result.sort((a, b) => (b.deletedAt!.getTime() - a.deletedAt!.getTime()))
    return result
  }

  /** 判断目标是否处于"已删子树"内：自身 deleted 或任一祖先 deleted */
  private async isInDeletedSubtree(target: { id: bigint; parentId: bigint; userId: bigint; deletedAt: Date | null }): Promise<boolean> {
    if (target.deletedAt !== null) return true
    let cursor = target.parentId
    for (let depth = 0; depth < MAX_CHILDREN && cursor !== BigInt(0); depth++) {
      const parent = await this.prisma.cloudFile.findFirst({
        where: { id: cursor, userId: target.userId },
        select: { parentId: true, deletedAt: true },
      })
      if (!parent) return false
      if (parent.deletedAt !== null) return true
      cursor = parent.parentId
    }
    return false
  }

  /**
   * BFS 收集整棵子树并彻底删除：收集所有 storage_name（文件）+ 所有 id（含目录）→
   * 删分享 → 删物理文件 → 删 DB 行 → 回扣 used。
   * 传入 roots 为待删除的顶层被删项（自身 + 后代）。
   */
  private async purgeSubtree(
    userId: bigint,
    roots: Array<{ id: bigint; parentId: bigint }>,
  ): Promise<{ files: number; bytes: bigint }> {
    const ids: bigint[] = []
    const storageNames: string[] = []
    let bytes = BigInt(0)
    let fileCount = 0

    // BFS 收集整棵子树
    const queue: bigint[] = roots.map((r) => r.id)
    while (queue.length > 0) {
      const currentId = queue.shift()!
      ids.push(currentId)
      const children = await this.prisma.cloudFile.findMany({
        where: { userId, parentId: currentId },
      })
      for (const child of children) {
        queue.push(child.id)
        if (child.isDir === 0) {
          fileCount++
          bytes += child.size
          if (child.storageName) storageNames.push(child.storageName)
        }
      }
    }

    // 连带删除子树内文件的分享记录（R8）
    await this.prisma.cloudShare.deleteMany({ where: { userId, fileId: { in: ids } } })

    // 删物理文件（单个失败只记 warn 不阻断）
    for (const storageName of storageNames) {
      try {
        await this.storage.remove(storageName)
      } catch {
        this.logger.warn(`彻底删除物理文件失败（继续）: ${storageName}`)
      }
    }

    // 删 DB 行（整棵子树）
    await this.prisma.cloudFile.deleteMany({ where: { userId, id: { in: ids } } })

    // used 回扣（R3：不小于 0 兜底）
    if (bytes > BigInt(0)) {
      await this.prisma.cloudUsage.updateMany({
        where: { userId },
        data: { used: { decrement: bytes } },
      })
      // 兜底：used 永不为负
      await this.prisma.$executeRawUnsafe(
        'UPDATE cloud_usage SET used = 0 WHERE user_id = ? AND used < 0',
        userId.toString(),
      )
    }

    return { files: fileCount, bytes }
  }

  /** 列表项序列化（与 5.2 的 item 结构一致，附加 deletedAt） */
  private toItem(f: {
    id: bigint
    name: string
    isDir: number
    size: bigint
    ext: string | null
    mime: string | null
    updateTime: Date
    deletedAt: Date | null
  }) {
    return {
      id: f.id,
      name: f.name,
      isDir: f.isDir,
      size: f.size,
      ext: f.ext,
      mime: f.mime,
      updateTime: f.updateTime,
      deletedAt: f.deletedAt,
    }
  }
}
