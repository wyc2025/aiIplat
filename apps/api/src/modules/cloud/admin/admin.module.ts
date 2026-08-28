import { Module } from '@nestjs/common'
import { AdminController } from './admin.controller'
import { AdminService } from './admin.service'
import { FileModule } from '../file/file.module'

@Module({
  imports: [FileModule],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [],
})
export class AdminModule {}
