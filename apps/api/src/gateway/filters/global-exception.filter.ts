import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common'
import type { Request, Response } from 'express'
import { ErrorCode } from '../../common/constants/error-code'
import { BusinessException } from '../../common/exceptions/business.exception'
import { maskSensitiveQuery } from '../../common/utils/url-mask.util'

/** HTTP 状态码 → 统一错误码映射 */
const HTTP_STATUS_TO_CODE: Record<number, number> = {
  400: ErrorCode.ParamInvalid,
  401: ErrorCode.Unauthorized,
  403: ErrorCode.Forbidden,
  404: ErrorCode.NotFound,
  // Multer 文件超限被 platform-express 包装为 PayloadTooLargeException（ARCHITECTURE-P3 §13.3）
  413: ErrorCode.CloudFileTooLarge,
  429: ErrorCode.TooManyRequests,
}

/** 全局异常兜底：所有异常统一转为 { code, message, data: null } */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name)

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()
    const request = ctx.getRequest<Request>()

    if (exception instanceof BusinessException) {
      // 业务异常：HTTP 状态恒为 200，错误码在响应体
      response.status(200).json({ code: exception.code, message: exception.message, data: null })
      return
    }

    // Multer 上传错误：multer 为 @nestjs/platform-express 的传递依赖（pnpm 隔离不可直接 import），
    // 按 MulterError 特征（name + code）鸭子识别（ARCHITECTURE-P3 §13.3：超限映射 30004）
    if (this.isMulterError(exception)) {
      const code =
        exception.code === 'LIMIT_FILE_SIZE' ? ErrorCode.CloudFileTooLarge : ErrorCode.ParamInvalid
      const message = exception.code === 'LIMIT_FILE_SIZE' ? '文件大小超出限制' : `上传处理失败（${exception.code}）`
      response.status(200).json({ code, message, data: null })
      return
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus()
      const code = HTTP_STATUS_TO_CODE[status] ?? ErrorCode.InternalError
      // Multer 超限（413）message 为英文 "File too large"，统一中文提示
      const message = status === 413 ? '文件大小超出限制' : this.resolveMessage(exception)
      response.status(status).json({ code, message, data: null })
      return
    }

    // P4E D56/T64：URL 记录前统一过 maskSensitiveQuery（sid / password 等查询参数打码）
    this.logger.error(
      `未捕获异常 ${request.method} ${maskSensitiveQuery(request.originalUrl)}`,
      exception instanceof Error ? exception.stack : String(exception),
    )
    response
      .status(500)
      .json({ code: ErrorCode.InternalError, message: '服务器内部错误', data: null })
  }

  /** MulterError 鸭子识别（name 标识 + 携带 code 字段） */
  private isMulterError(exception: unknown): exception is Error & { code: string } {
    return (
      exception instanceof Error &&
      exception.name === 'MulterError' &&
      'code' in exception &&
      typeof (exception as { code?: unknown }).code === 'string'
    )
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
