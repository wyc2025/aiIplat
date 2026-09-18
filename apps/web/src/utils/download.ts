/**
 * Blob 落盘 —— 全仓 Blob 下载唯一口径（P4F T69/D60）。
 *
 * 延后回收 URL：下载启动是异步的，紧接 `revokeObjectURL` 在部分浏览器上会取消下载（P4d 修复实测口径）。
 * 适用于任何「已拿到 Blob、要触发浏览器下载」的场景：单文件下载 / 打包下载 / 访客整包下载。
 * 新增同类需求一律复用本函数，禁止再写第二份 createObjectURL + a.click 实现。
 */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/**
 * 直链下载（P7 走查 W7）：URL 自带票据或公开 token 时，直接交给浏览器原生下载。
 *
 * 相比「axios 拉 Blob 再 saveBlob」，省掉整包内存驻留，且天然支持断点续传、进度与浏览器下载管理；
 * 文件名由后端 `Content-Disposition`（RFC 5987）决定，故 filename 一般不必传。
 * 注意：URL 是后端地址而非 objectURL，**不要 revoke**。
 */
export function downloadByUrl(url: string, filename?: string): void {
  const a = document.createElement('a')
  a.href = url
  if (filename) a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
}
