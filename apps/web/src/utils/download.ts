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
