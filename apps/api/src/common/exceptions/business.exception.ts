/**
 * 业务异常：HTTP 状态恒为 200，错误码放在响应体 code 字段，
 * 由 GlobalExceptionFilter 统一转为 { code, message, data: null }
 */
export class BusinessException extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message)
    this.name = BusinessException.name
  }
}
