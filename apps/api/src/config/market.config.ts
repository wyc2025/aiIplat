import { registerAs } from '@nestjs/config'

/** 正整数读取：非法或缺省回退默认值（与 app/site/upload 配置组风格一致） */
function readPositiveInt(key: string, fallback: number): number {
  const value = Number(process.env[key])
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

/**
 * market 域配置（P13 T117，架构增补 §29.6）：应用市场护栏，均有默认值，.env 可选覆盖（前缀 MARKET_*）。
 * 零新依赖、零必需环境变量（不进 validate.ts 的 REQUIRED_ENV_KEYS）。
 */
export default registerAs('market', () => ({
  /** 演示数据单表行数上限（R118，超出提交 50015） */
  demoMaxRowsPerTable: readPositiveInt('MARKET_DEMO_MAX_ROWS_PER_TABLE', 100),
  /** 结构快照字节上限（R117 护栏，超出提交 50015；结构即数据模型，正常不可能超） */
  snapshotMaxBytes: readPositiveInt('MARKET_SNAPSHOT_MAX_BYTES', 256 * 1024),
}))
