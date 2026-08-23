import { SetMetadata } from '@nestjs/common'

export const OPERATION_LOG_KEY = 'operationLog'

export interface OperationLogMeta {
  module: string
  action: string
}

/** 操作日志元数据，如 @OperationLog('用户管理', '新增用户')；异步落库由 OperationLogInterceptor（T6）实现 */
export const OperationLog = (module: string, action: string) =>
  SetMetadata(OPERATION_LOG_KEY, { module, action } as OperationLogMeta)
