import { HttpException } from '@nestjs/common'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { ErrorCode } from '../../../common/constants/error-code'
import { BusinessException } from '../../../common/exceptions/business.exception'

/**
 * 每请求上下文（P15-C R145）。
 *
 * 无状态模式下**每次 POST 独立构建** server（D131/R142），故本对象天然请求级隔离：
 * 工具执行时写回「返回行数」「业务码」「表名」，controller 在响应结束后统一记账
 * （行数配额 + `acc_audit` 流水）——工具层只报告事实，不自行记账（R141 同口径）。
 */
export interface McpRequestContext {
  /** 返回行数（`iplat_query_records` 按页大小、`iplat_get_record` 记 1） */
  rows: number
  /** 工具执行期业务码（0 成功；失败为 `ErrorCode` 值，供审计 `resultCode`） */
  resultCode: number
  /** 本次调用的工具名（tools/call 审计与参数摘要用） */
  toolName: string | null
  /** 被访问的逻辑表名（审计 `tableName`） */
  tableName: string | null
}

/** 新建请求上下文（controller 每次 POST 调一次） */
export function createRequestContext(): McpRequestContext {
  return { rows: 0, resultCode: 0, toolName: null, tableName: null }
}

/**
 * 成功结果：**双形态输出**（R143）。
 *
 * - `structuredContent`：JSON 对象（与 REST v1 §22 的 `data` / `data + paging` 段一致）；
 * - `content[0].text`：同一对象的 JSON 字符串（兼容只读文本的旧客户端）。
 */
export function toolOk(structuredContent: Record<string, unknown>): CallToolResult {
  return {
    structuredContent,
    content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
  }
}

/**
 * 业务失败结果（R144）：`isError = true` + 文本含业务码。
 *
 * **分层原则**：认证与配额在 HTTP 层解决（401 + `WWW-Authenticate` / 429 + `Retry-After`，
 * 客户端可自动发现与重试），业务语义在工具结果内解决（Agent 读文本自纠）——
 * 故此处不落 HTTP 状态码，错误码与 REST v1 同源（40400 未暴露表 / 50021 字段越界 /
 * 40001 参数违例 / 50009 操作越界）。
 */
export function toolError(error: unknown): CallToolResult {
  const code = toolErrorCode(error)
  return {
    isError: true,
    content: [{ type: 'text', text: `[${code}] ${toolErrorMessage(error, code)}` }],
  }
}

/** 业务码提取（业务异常取业务码；带业务码的 `HttpException` 取之；其余按内部错误 50000） */
export function toolErrorCode(error: unknown): number {
  if (error instanceof BusinessException) return error.code
  if (error instanceof HttpException) {
    const body = error.getResponse()
    if (body && typeof body === 'object' && typeof (body as { code?: unknown }).code === 'number') {
      return (body as { code: number }).code
    }
    return error.getStatus()
  }
  return ErrorCode.InternalError
}

function toolErrorMessage(error: unknown, code: number): string {
  if (error instanceof BusinessException || error instanceof HttpException) return error.message
  return code === ErrorCode.InternalError ? '服务器内部错误' : String(error)
}
