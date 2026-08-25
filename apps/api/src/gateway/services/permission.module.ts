import { Global, Module } from '@nestjs/common'
import { PermissionService } from './permission.service'

/** 权限判定服务全局模块：PermissionGuard 与 AI 工具层共用 */
@Global()
@Module({
  providers: [PermissionService],
  exports: [PermissionService],
})
export class PermissionModule {}
