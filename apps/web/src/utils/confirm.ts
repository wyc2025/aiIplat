import { ElMessageBox } from 'element-plus'
import type { ElMessageBoxOptions } from 'element-plus'

/**
 * 确认弹窗统一封装（P6 T81 / D72 / ARCHITECTURE §21.5）。
 *
 * 背景：`ElMessageBox.confirm` 在用户点「取消」/关闭/ESC 时 **reject**，调用方若直接
 * `await ElMessageBox.confirm(...)` 而不 try/catch，会产生未捕获 rejection 的 console 告警
 * （P4f 遗留 19）。全仓统一走本封装：取消 = 静默返回 false，调用方只判真假，不再各自 try/catch。
 *
 * 用法：
 * ```ts
 * if (!(await confirmDialog('确认删除该文件？', '警告', { type: 'warning' }))) return
 * await doRemove()
 * ```
 *
 * @param message 提示正文
 * @param title 标题（缺省「提示」）
 * @param options 透传 ElMessageBox 选项（type / confirmButtonText / cancelButtonText 等）
 * @returns true = 用户确认；false = 取消/关闭（静默，不抛异常）
 */
export async function confirmDialog(
  message: string,
  title = '提示',
  options: ElMessageBoxOptions = {},
): Promise<boolean> {
  try {
    await ElMessageBox.confirm(message, title, options)
    return true
  } catch {
    return false
  }
}
