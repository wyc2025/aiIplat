import { Module } from '@nestjs/common'
import { UsageAdminController } from './usage-admin.controller'
import { UsageController } from './usage.controller'
import { UsageService } from './usage.service'

@Module({
  controllers: [UsageController, UsageAdminController],
  providers: [UsageService],
  exports: [UsageService],
})
export class UsageModule {}
