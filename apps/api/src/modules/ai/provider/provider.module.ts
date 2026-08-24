import { Module } from '@nestjs/common'
import { AiProviderAdminController } from './provider-admin.controller'
import { AiProviderController } from './provider.controller'
import { AiProviderService } from './provider.service'

@Module({
  controllers: [AiProviderController, AiProviderAdminController],
  providers: [AiProviderService],
  exports: [AiProviderService],
})
export class AiProviderModule {}
