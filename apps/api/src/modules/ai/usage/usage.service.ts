import { Injectable } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { PageResultDto } from '../../../common/dto/page-result.dto'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import type { AdminUsageQueryDto, MyUsageQueryDto } from './dto/usage.dto'

@Injectable()
export class UsageService {
  constructor(private readonly prisma: PrismaService) {}

  /** 我的用量明细分页（按时间倒序，可按模型筛选） */
  async mine(userId: bigint, query: MyUsageQueryDto) {
    const where: Prisma.AiUsageLogWhereInput = {
      userId,
      ...(query.modelId ? { modelId: BigInt(query.modelId) } : {}),
    }
    const [list, total] = await Promise.all([
      this.prisma.aiUsageLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.take,
        include: {
          model: { select: { displayName: true } },
          conversation: { select: { title: true } },
        },
      }),
      this.prisma.aiUsageLog.count({ where }),
    ])

    const data = list.map((u) => ({
      id: u.id.toString(),
      modelDisplayName: u.model.displayName,
      conversationTitle: u.conversation.title,
      tokensInput: u.tokensInput,
      tokensOutput: u.tokensOutput,
      credits: u.credits,
      createdAt: u.createdAt,
    }))
    return new PageResultDto(data, total, query)
  }

  /** 管理端全量用量（用户名模糊 + 模型 + 时间范围），附加 summary 聚合 */
  async adminPage(query: AdminUsageQueryDto) {
    const where: Prisma.AiUsageLogWhereInput = {
      ...(query.username ? { user: { username: { contains: query.username } } } : {}),
      ...(query.modelId ? { modelId: BigInt(query.modelId) } : {}),
      ...(query.startTime || query.endTime
        ? {
            createdAt: {
              ...(query.startTime ? { gte: new Date(query.startTime) } : {}),
              ...(query.endTime ? { lte: new Date(query.endTime) } : {}),
            },
          }
        : {}),
    }

    const [list, total, summary] = await Promise.all([
      this.prisma.aiUsageLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.take,
        include: {
          model: { select: { displayName: true } },
          conversation: { select: { title: true } },
          user: { select: { username: true } },
        },
      }),
      this.prisma.aiUsageLog.count({ where }),
      this.prisma.aiUsageLog.aggregate({
        where,
        _sum: { tokensInput: true, tokensOutput: true, credits: true },
      }),
    ])

    const data = list.map((u) => ({
      id: u.id.toString(),
      username: u.user.username,
      modelDisplayName: u.model.displayName,
      conversationTitle: u.conversation.title,
      tokensInput: u.tokensInput,
      tokensOutput: u.tokensOutput,
      credits: u.credits,
      createdAt: u.createdAt,
    }))

    const page = new PageResultDto(data, total, query)
    return {
      ...page,
      summary: {
        totalTokensInput: summary._sum.tokensInput ?? 0,
        totalTokensOutput: summary._sum.tokensOutput ?? 0,
        totalCredits: summary._sum.credits ?? 0,
      },
    }
  }
}
