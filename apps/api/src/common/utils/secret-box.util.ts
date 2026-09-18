import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

/**
 * 可逆密钥箱（AES-256-GCM）：用于「本人可回显」的短口令类数据（当前用例：云盘分享提取码）。
 *
 * 为什么不用 bcrypt：bcrypt 是不可逆哈希，只能校验不能回显；分享者需要能看到自己设过的提取码，
 * 因此另存一份可解密密文（校验链路仍走 bcrypt 哈希，密文只服务「管理侧回显」）。
 *
 * 密文布局（base64）：iv(12) | authTag(16) | ciphertext，GCM 自带完整性校验，
 * 密钥不对/数据被改都会解密失败并返回 null（调用方按「不可回显」处理，不抛错）。
 */

/** GCM 推荐 12 字节 IV */
const IV_LENGTH = 12
/** GCM 认证标签 16 字节 */
const TAG_LENGTH = 16

/** 从任意长度口令派生 32 字节密钥（SHA-256） */
export function deriveKey(secret: string): Buffer {
  return createHash('sha256').update(secret).digest()
}

/** 加密短口令 → base64 密文；异常返回 null（调用方降级为「不回显」） */
export function encryptSecret(plain: string, key: Buffer): string | null {
  try {
    const iv = randomBytes(IV_LENGTH)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return Buffer.concat([iv, tag, encrypted]).toString('base64')
  } catch {
    return null
  }
}

/**
 * 解密 base64 密文；返回 null 表示：无密文（历史数据）/ 密钥不匹配 / 数据损坏。
 * 一律不抛错——回显失败不应影响列表接口可用性。
 */
export function decryptSecret(payload: string | null | undefined, key: Buffer): string | null {
  if (!payload) return null
  try {
    const raw = Buffer.from(payload, 'base64')
    if (raw.length <= IV_LENGTH + TAG_LENGTH) return null
    const iv = raw.subarray(0, IV_LENGTH)
    const tag = raw.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH)
    const data = raw.subarray(IV_LENGTH + TAG_LENGTH)
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}
