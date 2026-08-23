import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'

@Module({
  // secret/expiresIn 在签发时按 access/refresh 分别显式传入，此处无需全局配置
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
