import { registerAs } from '@nestjs/config'

/** 正整数读取：非法或缺省回退默认值（与 P3 upload 配置组风格一致） */
function readPositiveInt(key: string, fallback: number): number {
  const value = Number(process.env[key])
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

/**
 * site 域配置（P4a）：开放层独立限流，均有默认值，.env 可选覆盖（见架构增补 §14.12）
 */
export default registerAs('site', () => ({
  /** 开放静态限流（次/分/IP，默认 120） */
  siteOpenStaticRateLimit: readPositiveInt('SITE_OPEN_STATIC_RATE_LIMIT', 120),
  /** 开放数据限流（次/分/IP，默认 60） */
  siteOpenApiRateLimit: readPositiveInt('SITE_OPEN_API_RATE_LIMIT', 60),
  /** 评论提交限流（次/分/IP，默认 10） */
  siteCommentRateLimit: readPositiveInt('SITE_COMMENT_RATE_LIMIT', 10),
  /** 站点数配额默认上限（P4E D51，默认 1 = 与 P4d 单站行为一致） */
  defaultLimit: readPositiveInt('SITE_DEFAULT_LIMIT', 1),
  /**
   * 站点版本保留上限（P19 D147/T160）：**未锁定**版本数超过该值时自动清理最旧的；
   * 当前版本与锁定版本豁免（R158）。默认 20。
   */
  releaseKeep: readPositiveInt('SITE_RELEASE_KEEP', 20),
}))
