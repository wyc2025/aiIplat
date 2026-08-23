import { Injectable, type OnModuleDestroy } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'

/**
 * 全局 Prisma 服务。
 * PrismaClient 默认懒连接（首次查询时建立连接），无需启动时显式 $connect，
 * 因此中间件未启动也不影响服务启动，首次查询才会报连接错误。
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  async onModuleDestroy() {
    await this.$disconnect()
  }
}
