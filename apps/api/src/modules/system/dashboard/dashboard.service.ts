import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../../infra/prisma/prisma.service'

/** $queryRaw 返回的按日计数行（MySQL COUNT(*) 映射为 bigint） */
interface DailyCountRow {
  date: string
  count: bigint
}

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /** 统计卡片：用户总数、角色总数、今日登录次数、今日操作次数（PRD F3） */
  async getStats() {
    const todayStart = startOfToday()
    const [userCount, roleCount, todayLoginCount, todayOperationCount] = await Promise.all([
      this.prisma.sysUser.count({ where: { deletedAt: null } }),
      this.prisma.sysRole.count({ where: { deletedAt: null } }),
      this.prisma.sysLoginLog.count({ where: { createdAt: { gte: todayStart } } }),
      this.prisma.sysOperationLog.count({ where: { createdAt: { gte: todayStart } } }),
    ])
    return { userCount, roleCount, todayLoginCount, todayOperationCount }
  }

  /** 近 7 天登录趋势（含今日；无数据的日期补 0），供折线图渲染 */
  async getLoginTrend(days = 7) {
    const start = startOfToday()
    start.setDate(start.getDate() - (days - 1))

    // DATE_FORMAT 直接返回字符串日期，避免驱动层 Date 类型歧义；tagged template 自动参数化
    const rows = await this.prisma.$queryRaw<DailyCountRow[]>`
      SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS date, COUNT(*) AS count
      FROM sys_login_log
      WHERE created_at >= ${start}
      GROUP BY DATE_FORMAT(created_at, '%Y-%m-%d')
    `
    const countMap = new Map(rows.map((row) => [row.date, Number(row.count)]))

    const list = Array.from({ length: days }, (_, index) => {
      const date = new Date(start)
      date.setDate(start.getDate() + index)
      const key = formatLocalDate(date)
      return { date: key, count: countMap.get(key) ?? 0 }
    })
    return { list }
  }
}

/** 今日零点（本地时区，与日志写入的时区口径一致） */
function startOfToday(): Date {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  return date
}

/** 本地日期格式化为 YYYY-MM-DD */
function formatLocalDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}
