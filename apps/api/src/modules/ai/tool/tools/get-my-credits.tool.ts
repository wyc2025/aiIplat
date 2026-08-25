import type { CreditService } from '../../credit/credit.service'
import type { AiTool } from '../tool.types'

/** 查询当前用户的套餐与积分用量（read，登录即可） */
export function createGetMyCreditsTool(creditService: CreditService): AiTool {
  return {
    name: 'get_my_credits',
    title: '查询我的积分',
    description: '查询当前登录用户的 AI 套餐与积分用量（套餐、总额度、已用、剩余、周期）',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    risk: 'read',
    handler: async (ctx) => {
      const check = await creditService.precheck(BigInt(ctx.user.userId))
      return {
        totalCredits: check.totalCredits.toString(),
        usedCredits: check.usedCredits.toString(),
        remainingCredits: check.remainingCredits.toString(),
        cycleStart: check.cycleStart,
        cycleEnd: check.cycleEnd,
      }
    },
  }
}
