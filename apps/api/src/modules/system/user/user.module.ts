import { Module } from '@nestjs/common'
import { ProfileController } from './profile.controller'
import { UserController } from './user.controller'
import { UserService } from './user.service'

@Module({
  // ProfileController 必须注册在 UserController 之前：
  // Express 按注册顺序匹配路由，system/user/profile 需先于 system/user/:id，
  // 否则会被 :id 的 ParseIntPipe 拦截报 40001
  controllers: [ProfileController, UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
