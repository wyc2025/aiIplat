import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../../infra/prisma/prisma.service'

/**
 * site 域门面：跨域（system 等）只通过本门面与 site 交互，禁止直接 import 域内实现（域边界纪律）。
 * 封装：删用户预检 hasSite（R13 / PRD-P4A D14）。
 */
@Injectable()
export class SiteFacade {
  constructor(private readonly prisma: PrismaService) {}

  /** 用户是否已开通站点（有 site_site 行即 true）；删除用户前预检，与 cloud hasFiles 并列 */
  async hasSite(userId: bigint): Promise<boolean> {
    const count = await this.prisma.siteSite.count({ where: { userId } })
    return count > 0
  }
}
