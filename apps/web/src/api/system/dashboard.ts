import { get } from '@/utils/request'

/** 工作台统计卡片 */
export interface DashboardStats {
  userCount: number
  roleCount: number
  todayLoginCount: number
  todayOperationCount: number
}

/** 单日计数（趋势图） */
export interface TrendItem {
  date: string
  count: number
}

export const getDashboardStats = () => get<DashboardStats>('/system/dashboard/stats')

export const getLoginTrend = () => get<{ list: TrendItem[] }>('/system/dashboard/login-trend')
