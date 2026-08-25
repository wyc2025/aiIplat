import { Module } from '@nestjs/common'
import { ToolRegistry } from './tool.registry'

/**
 * 工具模块（P2b）：暴露 ToolRegistry。
 * 具体工具在 T22 实现（tools/ 目录），并通过 onModuleInit 注册到 ToolRegistry。
 */
@Module({
  providers: [ToolRegistry],
  exports: [ToolRegistry],
})
export class ToolModule {}
