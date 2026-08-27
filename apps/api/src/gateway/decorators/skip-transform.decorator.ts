import { SetMetadata } from '@nestjs/common'

export const SKIP_TRANSFORM_KEY = 'skipTransform'

/**
 * 标记接口跳过统一响应包装与操作日志（流式接口专用，见 ARCHITECTURE §10）。
 * 适用：SSE（POST /api/ai/chat、/api/ai/tool/confirm）与文件流（P3 预览/下载）。
 * 前置校验失败仍走 GlobalExceptionFilter 统一 JSON 错误，
 * 进入流式后由 Controller 用 @Res() 原生写流。
 * TransformInterceptor 与 OperationLogInterceptor 识别此标记后跳过。
 */
export const SkipTransform = () => SetMetadata(SKIP_TRANSFORM_KEY, true)
