import { registerAs } from '@nestjs/config'

/** 正整数读取：非法或缺省回退默认值（与 site/upload 配置组风格一致） */
function readPositiveInt(key: string, fallback: number): number {
  const value = Number(process.env[key])
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

/** CSV 导入单文件上限（字节，默认 5MB；Multer 装饰器静态求值用） */
export function readAppMaxImportSize(): number {
  return readPositiveInt('APP_MAX_IMPORT_SIZE', 5 * 1024 * 1024)
}

/** 附件字段单文件上限（字节，默认 10MB；Multer 装饰器静态求值用） */
export function readAppMaxAttachmentSize(): number {
  return readPositiveInt('APP_MAX_ATTACHMENT_SIZE', 10 * 1024 * 1024)
}

/**
 * app 域配置（P11 T100，架构增补 §10）：数据应用配额与护栏，均有默认值，.env 可选覆盖（前缀 APP_*）。
 * 零新依赖、零必需环境变量（不进 validate.ts 的 REQUIRED_ENV_KEYS）。
 */
export default registerAs('app', () => ({
  /** active 应用上限（占额度） */
  maxAppsPerUser: readPositiveInt('APP_MAX_APPS_PER_USER', 10),
  /** 草稿上限（draft 不占 active 额度） */
  maxDraftsPerUser: readPositiveInt('APP_MAX_DRAFTS_PER_USER', 3),
  /** 逻辑表上限（is_system 中间表不计） */
  maxTablesPerApp: readPositiveInt('APP_MAX_TABLES_PER_APP', 20),
  /** 单表数据行上限 */
  maxRowsPerTable: readPositiveInt('APP_MAX_ROWS_PER_TABLE', 50000),
  /** 功能页上限 */
  maxPagesPerApp: readPositiveInt('APP_MAX_PAGES_PER_APP', 50),
  /** 附件字段单文件上限（字节，默认 10MB；占云盘配额） */
  maxAttachmentSize: readPositiveInt('APP_MAX_ATTACHMENT_SIZE', 10 * 1024 * 1024),
  /** CSV 导入单文件上限（字节，默认 5MB） */
  maxImportSize: readPositiveInt('APP_MAX_IMPORT_SIZE', 5 * 1024 * 1024),
  /** r_cN 热索引字段数（生成列数量） */
  hotIndexFieldsPerTable: readPositiveInt('APP_HOT_INDEX_FIELDS', 5),
  /** 单查询护栏（毫秒；超时拒绝 50009） */
  queryTimeoutMs: readPositiveInt('APP_QUERY_TIMEOUT_MS', 2000),
  /** 草稿过期清理天数（默认 7） */
  draftTtlDays: readPositiveInt('APP_DRAFT_TTL_DAYS', 7),

  // ===== P12 公开面（R104/R105/R106，架构增补 §28.7）=====
  /** 公开列表 size 上限（R104，默认 20） */
  pubListMaxSize: readPositiveInt('APP_PUB_LIST_MAX_SIZE', 50),
  /** 公开 filter 组数上限（R104） */
  pubFilterMaxGroups: readPositiveInt('APP_PUB_FILTER_MAX_GROUPS', 3),
  /** 公开 sort 字段数上限（R104） */
  pubSortMaxFields: readPositiveInt('APP_PUB_SORT_MAX_FIELDS', 2),
  /** 公开数据缓存 TTL（秒；R105 写后失效兜底） */
  pubDataCacheTtlSeconds: readPositiveInt('APP_PUB_DATA_CACHE_TTL_SECONDS', 60),
  /** 公开 manifest / schema 缓存 TTL（秒；R105） */
  pubManifestCacheTtlSeconds: readPositiveInt('APP_PUB_MANIFEST_CACHE_TTL_SECONDS', 600),
  /** 公开端点限流（次/分/IP；R106 触发 42900） */
  pubRateLimitPerMinute: readPositiveInt('APP_PUB_RATE_LIMIT_PER_MINUTE', 60),
}))
