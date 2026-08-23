import type { LoginLogItem, OperationLogItem, PageQuery, PageResult } from '@/types/api'
import { get } from '@/utils/request'

export interface LoginLogQuery extends PageQuery {
  username?: string
  status?: number
  startTime?: string
  endTime?: string
}

export interface OperationLogQuery extends PageQuery {
  username?: string
  module?: string
  status?: number
  startTime?: string
  endTime?: string
}

export const getLoginLogPage = (params: LoginLogQuery) =>
  get<PageResult<LoginLogItem>>('/system/log/login', params as Record<string, unknown>)

export const getOperationLogPage = (params: OperationLogQuery) =>
  get<PageResult<OperationLogItem>>('/system/log/operation', params as Record<string, unknown>)
