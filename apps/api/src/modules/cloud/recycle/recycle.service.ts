import { Injectable, Logger } from '@nestjs/common'
import { ErrorCode } from '../../../common/constants/error-code'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import { StorageService } from '../../../infra/storage/storage.service'
import { AppRefService } from '../../app/facade/app-ref.service'
import { AVATAR_PARENT_ID, FileService, MAX_CHILDREN } from '../file/file.service'
import type { RecycleListQueryDto } from './dto/recycle.dto'

/** 回收站自动清理每批扫描行数上限（R59：分批执行，单批失败记录并继续下批） */
const CLEAN_BATCH_SIZE = 500
/** 每日毫秒数（保留天数换算） */
const DAY_MS = 24 * 60 * 60 * 1000

/** 回收站自动清理统计（P4F R59 运行日志口径） */
export interface RecycleCleanStats {
  /** 本轮扫描到的超期行数（含随父行级联的子行） */
  scanned: number
  /** 实际执行的清理单元数（顶层项） */
  purged: number
  /** 清理失败项数（只记日志，不影响其他项） */
  failed: number
  /** 物理删除的文件数 */
  files: number
  /** 回退的 used 字节数（不含已回退过的头像旧行） */
  bytes: bigint
}

/** 回收站：顶层被删项查询（R2 算法）/ 只读浏览 / 还原（R5）/ 彻底删除（递归子树 + 连带删分享 + used 回扣 R3）/ 清空 / 超期自动清理（P4F T67） */
@Injectable()
export class RecycleService {
  private readonly logger = new Logger(RecycleService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly fileService: FileService,
    private readonly appRef: AppRefService,
  ) {}

  /**
   * 回收站列表：
   * - 无 parentId → 顶层被删项（R2 算法，ARCHITECTURE.md §4.7 禁 JOIN 应用层过滤）
   * - 带 parentId → 只读浏览该被删文件夹内容（前置校验目标处于已删子树内）
   */
  async list(userId: bigint, query: RecycleListQueryDto) {
    // parentId 缺省或 0 = 顶层被删项（前端进入回收站根会传 parentId=0）
    if (!query.parentId) {
      const topLevel = await this.findTopLevelDeleted(userId)
      return topLevel.map((f) => this.toItem(f))
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
    return [...dirs, ...files].map((f) => this.toItem(f))
  }

  /** 回收站面包屑链：根固定为「回收站」，后续为从被删项向上到其直接子级（自身必为 deleted 根） */
  async path(userId: bigint, id: bigint) {
    // 根（回收站本身）返回空链：根"回收站"由前端固定渲染（对齐 file.path 约定：链不含根）
    if (id === BigInt(0)) return []

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
    return upward
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
   * 彻底删除（R3/R8，ARCHITECTURE.md §4.7）：BFS 收集整棵子树（自身 + 全部后代）→ 连带删分享 →
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
   * 顶层被删项（R2 算法，ARCHITECTURE.md §4.7 禁 JOIN）：
   * 自身 deleted_at 非空 且 沿 parent_id 上溯无 deleted 祖先。
   * 实现：查该用户全部 deleted 项 → 集合内比对祖先；祖先不在集合时补查父行 deleted_at。
   */
  private async findTopLevelDeleted(userId: bigint) {
    const deleted = await this.prisma.cloudFile.findMany({
      // P6 T81/D72：排除头像旧行（parent_id = -1，AVATAR_PARENT_ID）——它们是不可达虚拟父目录下的
      // 内部行，用户不可还原/清理，故不出现在回收站列表；30 天自动清理仍照常处理（R59 通道不变）。
      where: { userId, deletedAt: { not: null }, parentId: { not: AVATAR_PARENT_ID } },
    })
    if (deleted.length === 0) return []

    const deletedSet = new Set(deleted.map((f) => f.id.toString()))
    const result: typeof deleted = []
    for (const item of deleted) {
      if (!(await this.hasDeletedAncestor(userId, item.parentId, deletedSet))) result.push(item)
    }
    // 按删除时间倒序（回收站列表展示）
    result.sort((a, b) => (b.deletedAt!.getTime() - a.deletedAt!.getTime()))
    return result
  }

  /**
   * 上溯判断「是否存在已删祖先」（回收站顶层归集与自动清理子树去重的共用判定）：
   * 先查集合快路径（deletedSet），未命中再补查父行 deleted_at；
   * 上溯最多 MAX_CHILDREN 层防环（目录深度上限即 10 层）。
   */
  private async hasDeletedAncestor(
    userId: bigint,
    parentId: bigint,
    deletedSet?: Set<string>,
  ): Promise<boolean> {
    let cursor = parentId
    for (let depth = 0; depth < MAX_CHILDREN && cursor !== BigInt(0); depth++) {
      if (deletedSet?.has(cursor.toString())) return true
      // 祖先不在集合：补查父行确认是否 deleted
      const parent = await this.prisma.cloudFile.findFirst({
        where: { id: cursor, userId },
        select: { id: true, parentId: true, deletedAt: true },
      })
      if (!parent) break
      if (parent.deletedAt !== null) return true
      cursor = parent.parentId
    }
    return false
  }

  /**
   * 回收站超期自动清理（P4F T67 / R58 / R59 / D58）：
   * 凡 `deleted_at` 早于 now - retentionDays 的行一律清除（含普通文件/文件夹、删站后进回收站的
   * 原站点根、以及头像旧行 parent_id=-1 且已软删）。
   *
   * - **执行单元 = 超期行中的「最顶层项」**：父行清理会级联子行，避免重复删除 / 重复回退 used
   * - **头像旧行特殊处理**：换头像时 used 已回退（CloudFacade.saveAvatar），故清理只删物理文件与行、
   *   不再回退 used（否则 used 会二次下探，与 R60 对账公式给出的应然值不再一致）
   * - 分批 ≤ CLEAN_BATCH_SIZE 行；单行失败只记日志、继续处理其他行；整体幂等可重入（下轮自然续扫）
   */
  async cleanExpired(retentionDays: number, batchSize = CLEAN_BATCH_SIZE): Promise<RecycleCleanStats> {
    const cutoff = new Date(Date.now() - retentionDays * DAY_MS)
    const stats: RecycleCleanStats = {
      scanned: 0,
      purged: 0,
      failed: 0,
      files: 0,
      bytes: BigInt(0),
    }

    for (;;) {
      const batch = await this.prisma.cloudFile.findMany({
        where: { deletedAt: { lt: cutoff } },
        orderBy: { id: 'asc' },
        take: batchSize,
      })
      if (batch.length === 0) break
      stats.scanned += batch.length

      const expiredSet = new Set(batch.map((f) => f.id.toString()))
      let progressed = 0
      for (const row of batch) {
        // 非顶层：其顶层祖先同在本批（或本身已删但尚未超期）→ 留给父行级联，本轮跳过
        if (await this.hasDeletedAncestor(row.userId, row.parentId, expiredSet)) continue
        try {
          const isRevertedAvatar = row.parentId === AVATAR_PARENT_ID
          const result = await this.purgeSubtree(row.userId, [row], {
            refundUsed: !isRevertedAvatar,
          })
          stats.purged++
          stats.files += result.files
          stats.bytes += result.bytes
          progressed++
        } catch (error) {
          stats.failed++
          this.logger.error(
            `回收站自动清理失败（行 id=${row.id}，继续）：${(error as Error).message}`,
          )
        }
      }

      // 整批均为「已删子树的成员」（其顶层项尚未超期）→ 本轮无进展，等父行超期时一并清除
      if (progressed === 0) break
    }

    return stats
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
   * 传入 roots 为待删除的顶层被删项（自身 + 后代）；`options.refundUsed=false` 时只删行与物理文件、
   * 不动 used（P4F T67 头像旧行专用，见 cleanExpired 注释）。
   */
  private async purgeSubtree(
    userId: bigint,
    roots: Array<{ id: bigint; parentId: bigint }>,
    options: { refundUsed?: boolean } = {},
  ): Promise<{ files: number; bytes: bigint }> {
    const ids: bigint[] = []
    const fileIds: bigint[] = []
    const storageNames: string[] = []
    let bytes = BigInt(0)
    let fileCount = 0

    // BFS 收集整棵子树（含根自身——2026-09-10 修复：原实现只统计子代，顶层文件的
    // 彻底删除从不回扣 used、不删物理文件，T49 验证暴露）
    const queue: bigint[] = roots.map((r) => r.id)
    while (queue.length > 0) {
      const currentId = queue.shift()!
      const row = await this.prisma.cloudFile.findFirst({ where: { userId, id: currentId } })
      if (row) {
        ids.push(row.id)
        if (row.isDir === 0) {
          fileCount++
          bytes += row.size
          fileIds.push(row.id)
          if (row.storageName) storageNames.push(row.storageName)
        }
      }
      const children = await this.prisma.cloudFile.findMany({
        where: { userId, parentId: currentId },
      })
      for (const child of children) {
        queue.push(child.id)
      }
    }

    // P11 T103 / D96：彻底删除前预检应用引用（30021）——被数据应用引用的文件禁止物理清文件。
    // cron 清理（cleanExpired）命中此异常时按单行失败记录并继续，等效「跳过被引用文件」。
    if (fileIds.length > 0 && (await this.appRef.hasAttachmentRefs(userId, fileIds))) {
      throw new BusinessException(
        ErrorCode.CloudFileReferencedByApp,
        '子树内文件被数据应用引用，禁止彻底删除；请先在应用中解除引用或还原该文件',
      )
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

    // used 回扣（R3：不小于 0 兜底）；refundUsed=false 仅用于「换头像时已回退过」的头像旧行
    // （P4F T67/R58：二次回退会让 used 低于 R60 对账公式的应然值）
    if (bytes > BigInt(0) && options.refundUsed !== false) {
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
