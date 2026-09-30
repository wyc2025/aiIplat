import { ErrorCode } from '../../../../common/constants/error-code'
import { BusinessException } from '../../../../common/exceptions/business.exception'
import { feedAppError, readStr } from './app-error.util'

/**
 * display 域工具的公共小工具（P14 T130）：沿用 app 组的错误回喂口径
 * （业务异常 → `{ ok:false, errorCode, message }`，其余上抛），供展示应用两工具复用。
 */
export { readStr }

/** 业务异常回喂（与 app 组 feedAppError 同形，独立命名避免跨组耦合） */
export function feedDisplayError(error: unknown): {
  ok: false
  errorCode: number
  message: string
} {
  if (error instanceof BusinessException) {
    return { ok: false, errorCode: error.code, message: error.message }
  }
  return feedAppError(error) as { ok: false; errorCode: number; message: string }
}

/** 展示应用相关错误码（供工具层判断，避免 magic number） */
export const DISPLAY_ERROR_CODES = {
  notFound: ErrorCode.DisplayNotFound,
  grantConflict: ErrorCode.DisplayGrantConflict,
  nameConflict: ErrorCode.DisplayNameConflict,
} as const
