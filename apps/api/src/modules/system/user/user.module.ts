import { Module } from '@nestjs/common'
import { ProfileController } from './profile.controller'
import { UserController } from './user.controller'
import { UserService } from './user.service'
import { ProfileService } from './profile.service'
import { CloudModule } from '../../cloud/cloud.module'
import { StorageModule } from '../../../infra/storage/storage.module'

@Module({
  // ProfileController 必须注册在 UserController 之前：
  // Express 按注册顺序匹配路由，system/user/profile 需先于 system/user/:id，
  // 否则会被 :id 的 ParseIntPipe 拦截报 40001
  imports: [CloudModule, StorageModule],
  controllers: [ProfileController, UserController],
  providers: [UserService, ProfileService],
  exports: [UserService],
})
export class UserModule {}
