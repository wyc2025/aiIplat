import { registerAs } from '@nestjs/config'

/** 正整数读取：非法或缺省回退默认值（与 app/site/market 配置组风格一致） */
function readPositiveInt(key: string, fallback: number): number {
  const value = Number(process.env[key])
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

/**
 * display 域配置（P14 T124，API-P14 §21.4 / ARCHITECTURE §30.3）：展示应用护栏，均有默认值，
 * .env 可选覆盖（前缀 DISPLAY_*）。零新依赖、零必需环境变量（不进 validate.ts 的 REQUIRED_ENV_KEYS）。
 */
export default registerAs('display', () => ({
  /** 暂存区根目录名（云盘内；未挂靠展示应用目录的父目录，D112/R127：挂靠即移出） */
  stagingPath: process.env.DISPLAY_STAGING_PATH || 'disp-staging',
  /** 市场 bundle 物化重名递增上限 `(2)…(n)`，超出该展示应用记为跳过（API §21.4 / R128） */
  copyNameSuffixMax: readPositiveInt('DISPLAY_COPY_NAME_SUFFIX_MAX', 20),
}))
