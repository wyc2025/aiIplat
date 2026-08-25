import { Injectable } from '@nestjs/common'
import type { AiTool } from './tool.types'

/**
 * 工具注册表：Map<name, AiTool>。
 * 新增工具 = tools/ 下加一个文件并在此 register；模块启动时收集。
 * 只读访问（chat 层按权限过滤下发），禁止运行时增删。
 */
@Injectable()
export class ToolRegistry {
  private readonly tools = new Map<string, AiTool>()

  /** 注册工具（重复 name 抛错，防止覆盖） */
  register(tool: AiTool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`工具重复注册：${tool.name}`)
    }
    this.tools.set(tool.name, tool)
  }

  /** 获取单个工具 */
  get(name: string): AiTool | undefined {
    return this.tools.get(name)
  }

  /** 获取全部工具 */
  getAll(): AiTool[] {
    return [...this.tools.values()]
  }
}
