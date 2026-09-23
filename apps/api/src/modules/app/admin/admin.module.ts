import { Module } from '@nestjs/common'
import { AdminController } from './admin.controller'
import { AdminService } from './admin.service'
import { AppCleanTask } from './app-clean.task'

/**
 * 应用管理模块（P11 T101）：应用 CRUD + 草稿生命周期 + 配额 + 软删级联 + 清理定时任务。
 * 对外导出 AdminService：AppFacade（AI 工具）与 AppFacade 聚合层复用同一实现。
 */
@Module({
  controllers: [AdminController],
  providers: [AdminService, AppCleanTask],
  exports: [AdminService],
})
export class AdminModule {}
