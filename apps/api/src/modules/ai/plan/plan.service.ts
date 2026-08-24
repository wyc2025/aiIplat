import { Injectable } from '@nestjs/common'
import type { AiPlan } from '@prisma/client'
import { ErrorCode } from '../../../common/constants/error-code'
import { PageResultDto } from '../../../common/dto/page-result.dto'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import { CreditService } from '../credit/credit.service'
import type { AssignPlanDto, CreatePlanDto, PlanQueryDto, SubscribePlanDto, UpdatePlanDto } from './dto/plan.dto'

/** 套餐展示（bigint/Decimal 转 string） */
export interface PlanView {
  id: string
  name: string
  code: string
  monthlyCredits: string
  price: string
  description: string | null
  status: number
  sort: number
}

@Injectable()
export class PlanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly creditService: CreditService,
  ) {}

  // ========== 用户侧 ==========

  /** 启用中的套餐列表（卡片展示，登录即可） */
  async availablePlans(): Promise<PlanView[]> {
    const plans = await this.prisma.aiPlan.findMany({
      where: { status: 1, deletedAt: null },
      orderBy: { sort: 'asc' },
    })
    return plans.map((p) => this.toView(p))
  }

  /** 我的套餐（含周期与额度，未开通返回 plan=null；含懒重置） */
  async myPlan(userId: bigint) {
    let userPlan = await this.prisma.aiUserPlan.findUnique({
      where: { userId },
      include: { plan: true },
    })
    if (!userPlan) {
      return { plan: null, cycleStart: null, cycleEnd: null, totalCredits: '0', usedCredits: '0', remainingCredits: '0' }
    }

    // 懒重置（与 CreditService.precheck 同口径）
    if (userPlan.cycleEnd.getTime() <= Date.now()) {
      await this.creditService.resetExpiredCycles()
      userPlan = await this.prisma.aiUserPlan.findUnique({ where: { userId }, include: { plan: true } })
    }

    const remaining = userPlan!.totalCredits - userPlan!.usedCredits
    return {
      plan: this.toView(userPlan!.plan),
      cycleStart: userPlan!.cycleStart,
      cycleEnd: userPlan!.cycleEnd,
      totalCredits: userPlan!.totalCredits.toString(),
      usedCredits: userPlan!.usedCredits.toString(),
      remainingCredits: (remaining > 0n ? remaining : 0n).toString(),
    }
  }

  /** 开通/切换套餐：立即生效，按新套餐重置额度与周期（本期无支付） */
  async subscribe(userId: bigint, dto: SubscribePlanDto) {
    const plan = await this.assertPlanUsable(BigInt(dto.planId))
    await this.applyPlan(userId, plan)
    return { success: true }
  }

  // ========== 管理端 ==========

  /** 套餐分页（含生效订阅数） */
  async adminPage(query: PlanQueryDto) {
    const where = { deletedAt: null, ...(query.name ? { name: { contains: query.name } } : {}) }
    const [list, total] = await Promise.all([
      this.prisma.aiPlan.findMany({
        where,
        orderBy: { sort: 'asc' },
        skip: query.skip,
        take: query.take,
        include: { _count: { select: { userPlans: true } } },
      }),
      this.prisma.aiPlan.count({ where }),
    ])

    const data = list.map((p) => ({
      ...this.toView(p),
      activeSubscribers: p._count.userPlans,
    }))
    return new PageResultDto(data, total, query)
  }

  /** 创建套餐 */
  async create(dto: CreatePlanDto) {
    await this.assertCodeAvailable(dto.code)
    const plan = await this.prisma.aiPlan.create({
      data: { ...dto, monthlyCredits: BigInt(dto.monthlyCredits) },
    })
    return { id: plan.id.toString() }
  }

  /** 更新套餐 */
  async update(id: bigint, dto: UpdatePlanDto) {
    await this.assertPlanExists(id)
    const data = {
      ...dto,
      ...(dto.monthlyCredits !== undefined ? { monthlyCredits: BigInt(dto.monthlyCredits) } : {}),
    }
    const plan = await this.prisma.aiPlan.update({ where: { id }, data })
    return { id: plan.id.toString() }
  }

  /** 删除套餐（有生效订阅禁止） */
  async remove(id: bigint) {
    await this.assertPlanExists(id)
    const activeSubscribers = await this.prisma.aiUserPlan.count({ where: { planId: id } })
    if (activeSubscribers > 0) {
      throw new BusinessException(ErrorCode.AiPlanInUse, '该套餐下有生效中的订阅，不可删除')
    }
    await this.prisma.aiPlan.update({ where: { id }, data: { deletedAt: new Date() } })
    return { success: true }
  }

  /** 指派用户套餐（admin，立即生效） */
  async assign(dto: AssignPlanDto) {
    const plan = await this.assertPlanUsable(BigInt(dto.planId))
    await this.applyPlan(BigInt(dto.userId), plan)
    return { success: true }
  }

  // ========== 私有 ==========

  /** 给用户应用套餐：upsert 订阅，立即按新套餐重置周期与额度 */
  private async applyPlan(userId: bigint, plan: AiPlan): Promise<void> {
    const cycleStart = new Date()
    const cycleEnd = new Date(cycleStart)
    cycleEnd.setMonth(cycleEnd.getMonth() + 1)
    await this.prisma.aiUserPlan.upsert({
      where: { userId },
      update: {
        planId: plan.id,
        cycleStart,
        cycleEnd,
        totalCredits: plan.monthlyCredits,
        usedCredits: 0n,
      },
      create: {
        userId,
        planId: plan.id,
        cycleStart,
        cycleEnd,
        totalCredits: plan.monthlyCredits,
        usedCredits: 0n,
      },
    })
  }

  private async assertPlanUsable(planId: bigint): Promise<AiPlan> {
    const plan = await this.prisma.aiPlan.findFirst({ where: { id: planId, deletedAt: null, status: 1 } })
    if (!plan) throw new BusinessException(ErrorCode.NotFound, '套餐不存在或已停用')
    return plan
  }

  private async assertPlanExists(id: bigint): Promise<AiPlan> {
    const plan = await this.prisma.aiPlan.findFirst({ where: { id, deletedAt: null } })
    if (!plan) throw new BusinessException(ErrorCode.NotFound, '套餐不存在')
    return plan
  }

  private async assertCodeAvailable(code: string): Promise<void> {
    const exists = await this.prisma.aiPlan.findFirst({ where: { code, deletedAt: null } })
    if (exists) throw new BusinessException(ErrorCode.AiPlanCodeExists, '套餐标识已存在')
  }

  private toView(p: AiPlan): PlanView {
    return {
      id: p.id.toString(),
      name: p.name,
      code: p.code,
      monthlyCredits: p.monthlyCredits.toString(),
      price: p.price.toString(),
      description: p.description,
      status: p.status,
      sort: p.sort,
    }
  }
}
