import { Injectable } from '@nestjs/common'
import type { AiUserPlan } from '@prisma/client'
import { ErrorCode } from '../../../common/constants/error-code'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { PrismaService } from '../../../infra/prisma/prisma.service'

/** 预检结果：生效订阅 + 剩余积分 */
export interface CreditCheck {
  userPlanId: bigint
  planId: bigint
  totalCredits: bigint
  usedCredits: bigint
  remainingCredits: bigint
  cycleStart: Date
  cycleEnd: Date
}

/** 结算入参 */
export interface SettleParams {
  userId: bigint
  conversationId: bigint
  messageId: bigint
  modelId: bigint
  inputTokens: number
  outputTokens: number
  /** 1 = usage 为字符数估算（上游未返回），0 = 上游真实值 */
  estimated: number
}

/** 结算结果 */
export interface SettleResult {
  credits: number
  remainingCredits: bigint
}

/**
 * 积分服务（CreditService，见 ARCHITECTURE §11）。
 * 职责：预检（无套餐/余额不足）、懒重置、结算（按 message_id 幂等，事务内写 usage_log + 扣额度）。
 * 不感知会话、消息内容；模型单价换算口径：1 积分 = 内部计量单位，单价人工录入 ai_model 表。
 */
@Injectable()
export class CreditService {
  constructor(private readonly prisma: PrismaService) {}

  /** 预检：有生效套餐且剩余 > 0，否则 20001 / 20002；发现周期已过期就地懒重置 */
  async precheck(userId: bigint): Promise<CreditCheck> {
    let userPlan = await this.prisma.aiUserPlan.findUnique({ where: { userId } })
    if (!userPlan) {
      throw new BusinessException(ErrorCode.AiNoPlan, '尚未开通套餐，请先开通')
    }

    // 懒重置：cycle_end 已过则就地清零额度并滚动一个自然月
    if (userPlan.cycleEnd.getTime() <= Date.now()) {
      userPlan = await this.rollCycle(userPlan)
    }

    const remaining = userPlan.totalCredits - userPlan.usedCredits
    if (remaining <= 0n) {
      throw new BusinessException(ErrorCode.AiInsufficientCredits, '本周期积分已用尽，请开通或升级套餐')
    }

    return {
      userPlanId: userPlan.id,
      planId: userPlan.planId,
      totalCredits: userPlan.totalCredits,
      usedCredits: userPlan.usedCredits,
      remainingCredits: remaining,
      cycleStart: userPlan.cycleStart,
      cycleEnd: userPlan.cycleEnd,
    }
  }

  /**
   * 结算：按 message_id 幂等。事务内：已结算则直接返回当前剩余；
   * 否则查模型单价算积分 → 写 ai_usage_log → 扣 used_credits（允许在途一次超扣）。
   * 返回结算后的 remainingCredits（按 max(0, total - used) 计）。
   */
  async settle(params: SettleParams): Promise<SettleResult> {
    return this.prisma.$transaction(async (tx) => {
      // 幂等：已结算过则直接返回现有记录与当前剩余
      const existing = await tx.aiUsageLog.findUnique({ where: { messageId: params.messageId } })
      if (existing) {
        const userPlan = await tx.aiUserPlan.findUnique({ where: { userId: params.userId } })
        return { credits: existing.credits, remainingCredits: this.calcRemaining(userPlan) }
      }

      // 算积分：credits = ceil(in/1000*inPrice + out/1000*outPrice)
      const model = await tx.aiModel.findUnique({ where: { id: params.modelId } })
      if (!model) throw new BusinessException(ErrorCode.NotFound, '模型不存在')
      const credits = this.calcCredits(
        params.inputTokens,
        params.outputTokens,
        Number(model.inputPrice),
        Number(model.outputPrice),
      )

      // 写用量明细 + 扣额度
      await tx.aiUsageLog.create({
        data: {
          userId: params.userId,
          conversationId: params.conversationId,
          messageId: params.messageId,
          modelId: params.modelId,
          tokensInput: params.inputTokens,
          tokensOutput: params.outputTokens,
          estimated: params.estimated,
          credits,
        },
      })
      await tx.aiUserPlan.update({
        where: { userId: params.userId },
        data: { usedCredits: { increment: BigInt(credits) } },
      })

      const userPlan = await tx.aiUserPlan.findUnique({ where: { userId: params.userId } })
      return { credits, remainingCredits: this.calcRemaining(userPlan) }
    })
  }

  /** 懒重置：清零已用额度并滚动一个自然月周期 */
  private async rollCycle(userPlan: AiUserPlan): Promise<AiUserPlan> {
    const cycleStart = new Date()
    const cycleEnd = new Date(cycleStart)
    cycleEnd.setMonth(cycleEnd.getMonth() + 1)
    return this.prisma.aiUserPlan.update({
      where: { id: userPlan.id },
      data: { usedCredits: 0n, cycleStart, cycleEnd },
    })
  }

  /** 积分换算：ceil(输入tokens/1000×输入单价 + 输出tokens/1000×输出单价) */
  private calcCredits(inputTokens: number, outputTokens: number, inputPrice: number, outputPrice: number): number {
    const raw = (inputTokens / 1000) * inputPrice + (outputTokens / 1000) * outputPrice
    return Math.ceil(raw)
  }

  /** 展示层剩余：max(0, total - used) */
  private calcRemaining(userPlan: AiUserPlan | null): bigint {
    if (!userPlan) return 0n
    const diff = userPlan.totalCredits - userPlan.usedCredits
    return diff > 0n ? diff : 0n
  }
}
