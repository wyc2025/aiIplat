/**
 * 由请求路径推断对外端点名（`acc_audit.endpoint` 用）。
 *
 * 守卫（401 留痕）与审计拦截器（locals 缺失时的兜底）共用**同一处实现**（R141：禁止各写一套）。
 * 路径形态：`/api/ext/v1/app/{appCode}/{schema | tables/:t/records[/:rowId] | files/:f/stream}`。
 */
export function extEndpointOf(path: string): string {
  if (path.endsWith('/schema')) return 'schema'
  if (path.includes('/records/')) return 'detail'
  if (path.includes('/records')) return 'records'
  if (path.includes('/stream')) return 'file'
  return 'unknown'
}
