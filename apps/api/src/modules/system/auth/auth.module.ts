import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { AppFacadeModule } from '../../app/facade/app-facade.module'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'

@Module({
  // secret/expiresIn 在签发时按 access/refresh 分别显式传入，此处无需全局配置
  // AppFacadeModule（P11 R96）：userinfo 菜单树追加「应用中心 ▸ 应用 ▸ 功能页」动态段
  imports: [JwtModule.register({}), AppFacadeModule],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
