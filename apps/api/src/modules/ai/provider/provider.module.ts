import { Module } from '@nestjs/common'
import { AiProviderController } from './provider.controller'
import { AiProviderService } from './provider.service'

@Module({
  controllers: [AiProviderController],
  providers: [AiProviderService],
  exports: [AiProviderService],
})
export class AiProviderModule {}
