import { Injectable } from '@nestjs/common'
import { PageResultDto } from '../../../common/dto/page-result.dto'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import type { LoginLogQueryDto, OperationLogQueryDto } from './dto/log.dto'

@Injectable()
export class LogService {
  constructor(private readonly prisma: PrismaService) {}

  /** 登录日志分页 */
  async loginLogPage(query: LoginLogQueryDto) {
    const where = {
      ...(query.username ? { username: { contains: query.username } } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...this.timeRange(query.startTime, query.endTime),
    }
    const [list, total] = await Promise.all([
      this.prisma.sysLoginLog.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.sysLoginLog.count({ where }),
    ])
    return new PageResultDto(list, total, query)
  }

  /** 操作日志分页 */
  async operationLogPage(query: OperationLogQueryDto) {
    const where = {
      ...(query.username ? { username: { contains: query.username } } : {}),
      ...(query.module ? { module: { contains: query.module } } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...this.timeRange(query.startTime, query.endTime),
    }
    const [list, total] = await Promise.all([
      this.prisma.sysOperationLog.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.sysOperationLog.count({ where }),
    ])
    return new PageResultDto(list, total, query)
  }

  /** 构造 createdAt 时间范围条件 */
  private timeRange(startTime?: string, endTime?: string) {
    const createdAt: { gte?: Date; lte?: Date } = {}
    if (startTime) createdAt.gte = new Date(startTime)
    if (endTime) createdAt.lte = new Date(endTime)
    return createdAt.gte || createdAt.lte ? { createdAt } : {}
  }
}
