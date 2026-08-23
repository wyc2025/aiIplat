import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common'
import type { Response } from 'express'
import { ErrorCode } from '../../common/constants/error-code'
import { BusinessException } from '../../common/exceptions/business.exception'

/** HTTP 状态码 → 统一错误码映射 */
const HTTP_STATUS_TO_CODE: Record<number, number> = {
  400: ErrorCode.ParamInvalid,
  401: ErrorCode.Unauthorized,
  403: ErrorCode.Forbidden,
  404: ErrorCode.NotFound,
  429: ErrorCode.TooManyRequests,
}

/** 全局异常兜底：所有异常统一转为 { code, message, data: null } */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name)

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>()

    if (exception instanceof BusinessException) {
      // 业务异常：HTTP 状态恒为 200，错误码在响应体
      response.status(200).json({ code: exception.code, message: exception.message, data: null })
      return
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus()
      const code = HTTP_STATUS_TO_CODE[status] ?? ErrorCode.InternalError
      response.status(status).json({ code, message: this.resolveMessage(exception), data: null })
      return
    }

    this.logger.error('未捕获异常', exception instanceof Error ? exception.stack : String(exception))
    response
      .status(500)
      .json({ code: ErrorCode.InternalError, message: '服务器内部错误', data: null })
  }

  /** 从 HttpException 中提取人类可读的错误信息（兼容字符串与对象两种响应体） */
  private resolveMessage(exception: HttpException): string {
    const body = exception.getResponse()
    if (typeof body === 'string') return body
    if (body && typeof body === 'object' && 'message' in body) {
      const message = (body as { message: unknown }).message
      if (typeof message === 'string') return message
      if (Array.isArray(message) && typeof message[0] === 'string') return message[0]
    }
    return exception.message
  }
}
