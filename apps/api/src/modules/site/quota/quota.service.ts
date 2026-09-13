import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ErrorCode } from '../../../common/constants/error-code'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { PrismaService } from '../../../infra/prisma/prisma.service'

/**
 * 站点数配额（P4E D51/R47/R48，照 cloud 域 cloud_usage 先例）：
 * - 懒创建：首次建站 / 查配额时 upsert，quota 取配置 `site.defaultLimit`（env SITE_DEFAULT_LIMIT，默认 1，
 *   即与 P4d 单站行为完全一致）；
 * - checkCanCreate：count(site_site where user_id) >= limit → 40118（check-then-act 竞态按 T30 口径接受，
 *   个人场景不做分布式锁）；
 * - adminUpdate：下限 = 该用户当前站点数（R48），调低不影响存量站点，仅拦新建；
 * - **配额单点**：只在 manage.create 链首调用——手动建站与 AI `create_site` 同一入口，
 *   40118 口径天然一致（D55）。
 *
 * 注意语义：站点数配额是 **count** 语义（不是字节），与 cloud_usage 的字节配额不同。
 */
@Injectable()
export class SiteQuotaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** 当前站点数（count 语义） */
  async getUsed(userId: bigint): Promise<number> {
    return this.prisma.siteSite.count({ where: { userId } })
  }

  /** 配额上限（懒创建：首次访问即落 site_quota 行） */
  async getLimit(userId: bigint): Promise<number> {
    const row = await this.prisma.siteQuota.findUnique({ where: { userId } })
    if (row) return row.quota
    const created = await this.prisma.siteQuota.upsert({
      where: { userId },
      update: {},
      create: { userId, quota: this.config.get<number>('site.defaultLimit', 1) },
    })
    return created.quota
  }

  /** 配额视图 `{ limit, used }` */
  async getQuota(userId: bigint): Promise<{ limit: number; used: number }> {
    const [limit, used] = await Promise.all([this.getLimit(userId), this.getUsed(userId)])
    return { limit, used }
  }

  /** 建站前校验（R47）：used >= limit → 40118（message 带 limit/used） */
  async checkCanCreate(userId: bigint): Promise<void> {
    const { limit, used } = await this.getQuota(userId)
    if (used >= limit) {
      throw new BusinessException(
        ErrorCode.SiteQuotaExceeded,
        `站点数量已达上限（${used}/${limit}），请联系管理员调整配额`,
      )
    }
  }

  /** admin 调整配额（R48）：下限 = 当前站点数，低于下限 400 参数错误；懒创建 upsert */
  async adminUpdate(userId: bigint, limit: number): Promise<{ limit: number; used: number }> {
    const used = await this.getUsed(userId)
    if (limit < used) {
      throw new BusinessException(ErrorCode.ParamInvalid, `配额下限为当前站点数（${used}），不可低于该值`)
    }
    // 懒创建保底（保证 update 一定命中）
    await this.getLimit(userId)
    await this.prisma.siteQuota.update({ where: { userId }, data: { quota: limit } })
    return { limit, used }
  }
}
