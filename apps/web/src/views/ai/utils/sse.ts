import type { ApiResult } from '@/types/api'
import { clearTokens, getAccessToken, getRefreshToken, setTokens } from '@/utils/token'

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api'
const CODE_SUCCESS = 0
const CODE_TOKEN_INVALID = 40100

/** SSE 事件结构（与后端下发一致，P2b 起新增 tool_result / tool_confirm） */
export interface SseEvent {
  type: 'meta' | 'delta' | 'done' | 'error' | 'tool_result' | 'tool_confirm'
  [key: string]: unknown
}

/** SSE 请求回调 */
export interface SseCallbacks {
  /** 每收到一个 data 事件触发 */
  onEvent: (event: SseEvent) => void
  /** 业务错误（前置校验失败 / error 事件 / 网络错误） */
  onError?: (code: number, message: string) => void
}

/** SSE 会话句柄：暴露 stop() 中断（停止生成） */
export interface SseSession {
  stop: () => void
}

/** 调刷新接口换新 token 对（fetch 直连，不经 axios 拦截器） */
async function refreshTokens(): Promise<boolean> {
  const refreshToken = getRefreshToken()
  if (!refreshToken) return false
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    })
    const body = (await res.json()) as ApiResult<{ accessToken: string; refreshToken: string }>
    if (body.code === CODE_SUCCESS) {
      setTokens(body.data.accessToken, body.data.refreshToken)
      return true
    }
    return false
  } catch {
    return false
  }
}

/** 刷新失败：清 token 跳登录页 */
function handleRefreshFail(): void {
  clearTokens()
  if (!window.location.pathname.startsWith('/login')) {
    window.location.href = '/login'
  }
}

/**
 * SSE 客户端（fetch + ReadableStream 手动解析 data: 行，见 ARCHITECTURE §10）。
 * EventSource 不支持自定义请求头，故用 fetch。
 * - 40100：先 refresh 再重试一次（与 request.ts 同策略），失败清 token 跳登录
 * - signal 支持 AbortController 中断（停止生成）
 * 返回 SseSession 供调用方 stop()。
 */
export function sseRequest(
  url: string,
  body: unknown,
  callbacks: SseCallbacks,
): SseSession {
  const controller = new AbortController()
  const session: SseSession = { stop: () => controller.abort() }

  void run(url, body, callbacks, controller.signal, false)
  return session
}

/** 内部执行：发起请求并解析流；allowRetry 控制 40100 是否再重试一次 */
async function run(
  url: string,
  body: unknown,
  callbacks: SseCallbacks,
  signal: AbortSignal,
  retried: boolean,
): Promise<void> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}${url}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        Authorization: `Bearer ${getAccessToken() ?? ''}`,
      },
      body: JSON.stringify(body),
      signal,
    })
  } catch (error) {
    // AbortError：用户主动停止，静默
    if ((error as Error).name === 'AbortError') return
    callbacks.onError?.(50000, '网络异常，请检查网络后重试')
    return
  }

  const contentType = response.headers.get('Content-Type') ?? ''

  // 前置校验失败：统一 JSON 错误响应（GlobalExceptionFilter）
  if (contentType.includes('application/json')) {
    let result: ApiResult
    try {
      result = (await response.json()) as ApiResult
    } catch {
      callbacks.onError?.(50000, '响应解析失败')
      return
    }
    // token 失效：refresh 后重试一次
    if (result.code === CODE_TOKEN_INVALID && !retried) {
      const ok = await refreshTokens()
      if (ok) {
        await run(url, body, callbacks, signal, true)
        return
      }
      handleRefreshFail()
      return
    }
    callbacks.onError?.(result.code, result.message || '请求失败')
    return
  }

  // 进入流式：逐行解析 data: {...}
  await parseStream(response, callbacks, signal)
}

/** 解析 SSE 流：按 \n\n 分块，提取 data: 行 JSON.parse 后回调 */
async function parseStream(
  response: Response,
  callbacks: SseCallbacks,
  signal: AbortSignal,
): Promise<void> {
  const reader = response.body?.getReader()
  if (!reader) {
    callbacks.onError?.(50000, '无法读取响应流')
    return
  }

  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  try {
    for (;;) {
      if (signal.aborted) break
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // 按事件块（空行分隔）切分
      let sepIndex: number
      while ((sepIndex = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, sepIndex)
        buffer = buffer.slice(sepIndex + 2)
        handleBlock(block, callbacks)
      }
    }
    // 处理末尾残留块
    if (buffer.trim()) {
      handleBlock(buffer, callbacks)
    }
  } catch (error) {
    if ((error as Error).name !== 'AbortError') {
      callbacks.onError?.(50000, '连接中断，请重试')
    }
  } finally {
    reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

/** 处理单个事件块：忽略注释行（: ping），解析 data: 行 */
function handleBlock(block: string, callbacks: SseCallbacks): void {
  for (const line of block.split('\n')) {
    if (!line.startsWith('data:')) continue
    const jsonStr = line.slice(5).trim()
    if (!jsonStr) continue
    try {
      const event = JSON.parse(jsonStr) as SseEvent
      callbacks.onEvent(event)
    } catch {
      // 单个事件解析失败不阻断后续
    }
  }
}
