import { Injectable } from '@nestjs/common'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { ErrorCode } from '../../../common/constants/error-code'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import { FileService } from '../file/file.service'
import type { UpdateQuotaDto } from './dto/quota.dto'

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
    const user = await this.prisma.sysUser.findUnique({
      where: { id },
      select: { id: true },
    })
    if (!user) {
      throw new BusinessException(ErrorCode.NotFound, '目标用户不存在')
    }
    const { quota, used } = await this.fileService.getQuota(id)
    return {
      userId: id.toString(),
      quotaLimit: quota.toString(),
      quotaUsed: used.toString(),
    }
  }
}
