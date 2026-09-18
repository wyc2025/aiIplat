import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * 私有文件直链票据（P7 走查 W7）：让预览/下载走浏览器原生请求（Range / 断点续传 / 零内存驻留）。
 *
 * 背景：私有预览若走 axios 全量 Blob，必须整包下载完才能播放、无法拖动进度，且整个文件驻留 JS 堆。
 * 而原生 `<video>/<img>/<a download>` 无法携带 Authorization 头，故由登录态端点签发一张**单文件短票据**，
 * 让 URL 自证身份。
 *
 * 设计要点：
 * - 签名素材 `fileId.userId.exp`，HMAC-SHA256 输出 base64url，**无状态、不落库、不新增依赖/环境变量**；
 * - `userId` 与 `exp` 随 URL 一并携带（签名已覆盖二者，篡改必然校验失败）；
 * - TTL 2 小时：必须覆盖整段播放/下载会话，否则中途的 Range 请求会校验失败；
 * - 安全边界：票据不是 access token，只对单个文件有效；校验失败统一按「文件不存在」返回，不泄露存在性；
 * - 日志：nginx 访问日志已不含查询串（P4E T64 脱敏口径），票据不会落盘到 access_log。
 */
export const FILE_TICKET_TTL_MS = 2 * 60 * 60 * 1000

export interface FileTicket {
  /** base64url 签名 */
  ticket: string
  /** 过期时间戳（毫秒） */
  exp: number
}

/** 直链查询参数名（签发与校验共用，避免两处写死字符串） */
export const FILE_TICKET_PARAMS = {
  ticket: 'ticket',
  uid: 'uid',
  exp: 'exp',
  mode: 'mode',
} as const

function sign(secret: string, fileId: bigint, userId: bigint, exp: number): string {
  return createHmac('sha256', secret).update(`${fileId}.${userId}.${exp}`).digest('base64url')
}

/** 签发票据（exp = now + TTL） */
export function createFileTicket(
  secret: string,
  fileId: bigint,
  userId: bigint,
  now = Date.now(),
): FileTicket {
  const exp = now + FILE_TICKET_TTL_MS
  return { ticket: sign(secret, fileId, userId, exp), exp }
}

/**
 * 校验票据 → 返回票据内的 userId；签名不符 / 已过期 / 参数非法一律返回 null。
 * 签名比较用恒定时间比较（timingSafeEqual），避免计时侧信道。
 */
export function verifyFileTicket(
  secret: string,
  fileId: bigint,
  parts: { ticket?: string; uid?: string; exp?: string },
  now = Date.now(),
): bigint | null {
  const { ticket, uid, exp: expRaw } = parts
  if (!ticket || !uid || !expRaw || !/^\d+$/.test(uid)) return null
  const exp = Number(expRaw)
  if (!Number.isFinite(exp) || exp <= now) return null

  const expected = Buffer.from(sign(secret, fileId, BigInt(uid), exp))
  const actual = Buffer.from(ticket)
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null
  return BigInt(uid)
}
