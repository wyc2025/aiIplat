import { Injectable } from '@nestjs/common'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { ErrorCode } from '../../../common/constants/error-code'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import { AVATAR_PARENT_ID, FileService } from '../file/file.service'
import type { ReconcileUsageDto, UpdateQuotaDto } from './dto/quota.dto'

/** 对账公式单项明细（R60：行数 + 字节数） */
export interface ReconcilePart {
  count: number
  bytes: bigint
}

/** 对账结果（单用户）：stored = cloud_usage.used，expected = 公式应然值，diff = expected − stored */
export interface ReconcileResult {
  userId: string
  stored: bigint
  expected: bigint
  diff: bigint
  parts: { active: ReconcilePart; recycled: ReconcilePart; revertedAvatars: ReconcilePart }
}

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fileService: FileService,
  ) {}

  /** 调整用户配额；配额下限 = 当前已用容量（T30） */
  async updateQuota(dto: UpdateQuotaDto) {
    const userId = BigInt(dto.userId)
    // 目标用户存在性（直接读库，不跨域 import system 模块）
    const user = await this.prisma.sysUser.findUnique({
      where: { id: userId },
      select: { id: true },
    })
    if (!user) {
      throw new BusinessException(ErrorCode.NotFound, '目标用户不存在')
    }

    const { used } = await this.fileService.getQuota(userId)
    const quotaLimit = BigInt(dto.quotaLimit)
    if (quotaLimit < used) {
      throw new BusinessException(ErrorCode.ParamInvalid, '配额下限为当前已用容量，不可低于已用')
    }

    const data: { quota: bigint; used?: bigint } = { quota: quotaLimit }
    if (typeof dto.quotaUsed === 'number') {
      data.used = BigInt(dto.quotaUsed)
    }

    const usage = await this.prisma.cloudUsage.upsert({
      where: { userId },
      update: data,
      create: { userId, quota: quotaLimit, used: data.used ?? BigInt(0) },
    })

    return {
      userId: usage.userId.toString(),
      quotaLimit: usage.quota.toString(),
      quotaUsed: usage.used.toString(),
    }
  }

  /** 云盘全局统计：文件总数、总容量、活跃用户数 */
  async getStats() {
    const [fileCount, totalUsedAgg, activeUsers] = await Promise.all([
      this.prisma.cloudFile.count({ where: { deletedAt: null } }),
      this.prisma.cloudUsage.aggregate({ _sum: { used: true } }),
      this.prisma.sysUser.count({ where: { status: 1, deletedAt: null } }),
    ])
    return {
      fileCount,
      totalUsed: (totalUsedAgg._sum.used ?? BigInt(0)).toString(),
      activeUsers,
    }
  }

  /** 查询指定用户配额（含已用容量，作为调整下限参考） */
  async getQuota(userId: string) {
    const id = BigInt(userId)
    await this.assertUserExists(id)
    const { quota, used } = await this.fileService.getQuota(id)
    return {
      userId: id.toString(),
      quotaLimit: quota.toString(),
      quotaUsed: used.toString(),
    }
  }

  /**
   * 配额对账诊断（P4F T68 / R60，只读）：
   * `used 应然值 = Σ(未删除行 size) + Σ(回收站行 size) − Σ(已回退头像行 size)`。
   * 「已回退头像行」识别口径（以本实现为准）：`parent_id = -1`（AVATAR_PARENT_ID）且 `deleted_at` 非空
   * ——换头像时 `CloudFacade.saveAvatar` 已回退其 used，故这些字节不在 used 内，须从公式中扣除。
   * 三段均用 groupBy 聚合（COUNT/SUM，勿全量拉行）；`userId` 缺省 = 全用户逐条返回。
   */
  async reconcileUsage(userId?: string) {
    if (userId) {
      const id = BigInt(userId)
      await this.assertUserExists(id)
      const [result] = await this.buildReconcile([id])
      return result
    }

    // 全用户：cloud_usage 行 ∪ 文件行 的属主集合（无 usage 行但留了文件的历史用户也要能看出来）
    const [usageRows, fileOwners] = await Promise.all([
      this.prisma.cloudUsage.findMany({ select: { userId: true } }),
      this.prisma.cloudFile.findMany({ distinct: ['userId'], select: { userId: true } }),
    ])
    const ownerMap = new Map<string, bigint>()
    for (const row of [...usageRows, ...fileOwners]) {
      ownerMap.set(row.userId.toString(), row.userId)
    }
    const owners = [...ownerMap.values()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    return this.buildReconcile(owners)
  }

  /**
   * 配额对账修正（P4F T68 / R61，显式动作）：重算后只写 `cloud_usage.used` 一个字段，
   * 不动任何文件行；行不存在时懒创建（quota 取默认配额，照 FileService.getQuota 口径）。
   */
  async reconcileFix(dto: ReconcileUsageDto) {
    const userId = BigInt(dto.userId)
    await this.assertUserExists(userId)

    const [diagnose] = await this.buildReconcile([userId])
    // 懒创建 cloud_usage（不存在的用户行按默认配额建，used 随后被重算值覆盖）
    await this.fileService.getQuota(userId)
    const usage = await this.prisma.cloudUsage.update({
      where: { userId },
      data: { used: diagnose.expected },
    })

    return {
      userId: userId.toString(),
      oldUsed: diagnose.stored,
      newUsed: usage.used,
      diff: diagnose.diff,
    }
  }

  /** 目标用户存在性校验（直接读库，不跨域 import system 模块） */
  private async assertUserExists(userId: bigint): Promise<void> {
    const user = await this.prisma.sysUser.findUnique({
      where: { id: userId },
      select: { id: true },
    })
    if (!user) {
      throw new BusinessException(ErrorCode.NotFound, '目标用户不存在')
    }
  }

  /**
   * 对账公式聚合（R60）：三段各自 groupBy 取行数与字节数，回填 stored（cloud_usage.used）后算 diff。
   * 缺失段按 0 计（用户无对应行时 groupBy 不返回该 userId）。
   */
  private async buildReconcile(userIds: bigint[]): Promise<ReconcileResult[]> {
    if (userIds.length === 0) return []
    const scope = { userId: { in: userIds } }

    const [activeRows, recycledRows, revertedRows, usageRows] = await Promise.all([
      this.prisma.cloudFile.groupBy({
        by: ['userId'],
        where: { ...scope, deletedAt: null },
        _sum: { size: true },
        _count: { _all: true },
      }),
      this.prisma.cloudFile.groupBy({
        by: ['userId'],
        where: { ...scope, deletedAt: { not: null } },
        _sum: { size: true },
        _count: { _all: true },
      }),
      this.prisma.cloudFile.groupBy({
        by: ['userId'],
        where: { ...scope, parentId: AVATAR_PARENT_ID, deletedAt: { not: null } },
        _sum: { size: true },
        _count: { _all: true },
      }),
      this.prisma.cloudUsage.findMany({ where: scope, select: { userId: true, used: true } }),
    ])

    const emptyPart = (): ReconcilePart => ({ count: 0, bytes: BigInt(0) })
    const toPartMap = (rows: typeof activeRows): Map<string, ReconcilePart> =>
      new Map(
        rows.map((row) => [
          row.userId.toString(),
          { count: row._count._all, bytes: row._sum.size ?? BigInt(0) },
        ]),
      )

    const activeMap = toPartMap(activeRows)
    const recycledMap = toPartMap(recycledRows)
    const revertedMap = toPartMap(revertedRows)
    const storedMap = new Map(usageRows.map((row) => [row.userId.toString(), row.used]))

    return userIds.map((userId) => {
      const key = userId.toString()
      const active = activeMap.get(key) ?? emptyPart()
      const recycled = recycledMap.get(key) ?? emptyPart()
      const revertedAvatars = revertedMap.get(key) ?? emptyPart()
      const stored = storedMap.get(key) ?? BigInt(0)
      const expected = active.bytes + recycled.bytes - revertedAvatars.bytes
      return {
        userId: key,
        stored,
        expected,
        diff: expected - stored,
        parts: { active, recycled, revertedAvatars },
      }
    })
  }
}
