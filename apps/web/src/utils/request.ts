import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios'
import { ElMessage } from 'element-plus'
// ElMessage 为 JS 调用（非模板组件），unplugin-vue-components 不会自动注入其样式，需显式引入
import 'element-plus/es/components/message/style/css'
import type { ApiResult } from '@/types/api'
import { clearTokens, getAccessToken, getRefreshToken, setTokens } from './token'

/**
 * Axios 封装（ARCHITECTURE 3.3）：
 * - 请求拦截器自动携带 Bearer accessToken
 * - code===0 直接返回 data
 * - code===40100 单例静默刷新：并发请求挂起排队，刷新成功重放，失败清 token 跳 /login
 * - 其他 code 统一 ElMessage 报错并 reject
 */

const CODE_SUCCESS = 0
const CODE_TOKEN_INVALID = 40100

let isRefreshing = false
/** 刷新期间挂起的请求队列：刷新成功后用新 token 重放 */
let pendingQueue: Array<{
  resolve: (value: unknown) => void
  reject: (reason?: unknown) => void
  config: AxiosRequestConfig
}> = []

const instance: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '/api',
  timeout: 15000,
})

/** 是否无需带 token 的白名单接口（登录/刷新） */
function isWhiteList(url?: string): boolean {
  if (!url) return false
  return url.includes('/auth/login') || url.includes('/auth/refresh')
}

instance.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getAccessToken()
  if (token && !isWhiteList(config.url)) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

/** 调刷新接口换新 token 对（独立 axios，避免触发自身拦截器） */
async function doRefreshToken(): Promise<boolean> {
  const refreshToken = getRefreshToken()
  if (!refreshToken) return false
  try {
    const res = await axios.post<ApiResult<{ accessToken: string; refreshToken: string }>>(
      `${instance.defaults.baseURL}/auth/refresh`,
      { refreshToken },
    )
    if (res.data.code === CODE_SUCCESS) {
      setTokens(res.data.data.accessToken, res.data.data.refreshToken)
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
 * token 失效统一处理（HTTP 200 + code 40100 与 HTTP 401 两种形态都走这里）：
 * 单例刷新 → 成功则重放当前与挂起的请求；失败则清 token 跳登录页。
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
/**  上面函数注释见下方 enable；any：拦截器解包 AxiosResponse 后的类型收窄（见下方说明） */
async function handleTokenInvalid(config: AxiosRequestConfig, message: string): Promise<any> {
  if (!isRefreshing) {
    isRefreshing = true
    let success = false
    try {
      success = await doRefreshToken()
    } finally {
      isRefreshing = false
    }
    if (!success) {
      const queue = [...pendingQueue]
      pendingQueue = []
      queue.forEach((p) => p.reject(new Error(message)))
      handleRefreshFail()
      return Promise.reject(new Error(message))
    }
    // 刷新成功：重放刷新期间挂起的并发请求
    const queue = [...pendingQueue]
    pendingQueue = []
    queue.forEach((p) => instance.request(p.config).then(p.resolve as any).catch(p.reject))
    // 当前触发刷新的请求直接用新 token 重放（请求拦截器会重新携带）
    return instance.request(config)
  }
  // 刷新进行中：挂起等待，刷新成功后被重放
  return new Promise((resolve, reject) => {
    pendingQueue.push({ resolve, reject, config })
  })
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// 响应拦截器：把 AxiosResponse<ApiResult> 解包为业务 data，故 fulfilled 返回类型与 axios 默认
// 泛型不符，这里用 any 接收并在出口处收窄（自定义拦截器的常规处理）。
/* eslint-disable @typescript-eslint/no-explicit-any */
instance.interceptors.response.use(
  async (response: AxiosResponse<ApiResult>): Promise<any> => {
    const result = response.data

    if (result.code === CODE_SUCCESS) {
      return result.data
    }

    // token 失效（业务码形态）：静默刷新后重放（白名单接口不重试，直接报错）
    if (result.code === CODE_TOKEN_INVALID && !isWhiteList(response.config.url)) {
      return handleTokenInvalid(response.config, result.message)
    }

    // 其他业务错误统一提示
    ElMessage.error(result.message || '请求失败')
    return Promise.reject(new Error(result.message))
  },
  async (error) => {
    const config: AxiosRequestConfig | undefined = error?.config
    const status = error?.response?.status
    const bodyCode = error?.response?.data?.code
    // token 失效（HTTP 401 形态：后端过滤器对 UnauthorizedException 返回 HTTP 401 + code 40100）
    if (
      (status === 401 || bodyCode === CODE_TOKEN_INVALID) &&
      config &&
      !isWhiteList(config.url)
    ) {
      return handleTokenInvalid(config, error?.response?.data?.message || '登录已过期')
    }
    // HTTP 层错误（网络错误 / 5xx 等）
    ElMessage.error(error?.response?.data?.message || error.message || '网络异常')
    return Promise.reject(error)
  },
)
/* eslint-enable @typescript-eslint/no-explicit-any */

/** 统一请求出口：业务代码拿到的就是 data */
export function request<T = unknown>(config: AxiosRequestConfig): Promise<T> {
  return instance.request(config) as unknown as Promise<T>
}

export const get = <T = unknown>(url: string, params?: Record<string, unknown>): Promise<T> =>
  request<T>({ method: 'GET', url, params })

export const post = <T = unknown>(url: string, data?: unknown): Promise<T> =>
  request<T>({ method: 'POST', url, data })

export const put = <T = unknown>(url: string, data?: unknown): Promise<T> =>
  request<T>({ method: 'PUT', url, data })

export const del = <T = unknown>(url: string): Promise<T> => request<T>({ method: 'DELETE', url })

export default instance
