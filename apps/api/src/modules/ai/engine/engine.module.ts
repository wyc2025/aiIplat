import { Module } from '@nestjs/common'
import { ProviderService } from './provider.service'

/** 引擎层模块：对外暴露 ProviderService（OpenAI 兼容适配器） */
@Module({
  providers: [ProviderService],
  exports: [ProviderService],
})
export class EngineModule {}
