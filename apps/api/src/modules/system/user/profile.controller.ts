import {
  Body,
  Controller,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface'
import { CurrentUser } from '../../../gateway/decorators/current-user.decorator'
import { OperationLog } from '../../../gateway/decorators/operation-log.decorator'
import type { AuthUser } from '../../../gateway/guards/jwt.strategy'
import { ChangePasswordDto, UpdateProfileDto } from './dto/profile.dto'
import { UserService } from './user.service'
import { ProfileService } from './profile.service'
import { createTmpUploadStorage } from '../../../infra/storage/tmp-storage'

/** 头像上传 Multer 配置：复用 infra 公共上传引擎，限制图片单文件 ≤5MB（T30） */
const AVATAR_UPLOAD_OPTIONS: MulterOptions = {
  storage: createTmpUploadStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
}

/** 个人中心：登录用户自服务接口（只操作自己，无需管理端权限标识） */
@ApiTags('个人中心')
@ApiBearerAuth()
@Controller('system/user/profile')
export class ProfileController {
  constructor(
    private readonly userService: UserService,
    private readonly profileService: ProfileService,
  ) {}

  @Put()
  @OperationLog('个人中心', '修改基本信息')
  @ApiOperation({ summary: '修改自己的基本信息（昵称/邮箱/手机/性别）' })
  updateProfile(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.userService.updateProfile(BigInt(user.userId), dto)
  }

  @Put('password')
  @OperationLog('个人中心', '修改密码')
  @ApiOperation({ summary: '修改密码（校验旧密码，成功后全部会话失效）' })
  changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    return this.userService.changePassword(user, dto)
  }

  @Post('avatar')
  @UseInterceptors(FileInterceptor('file', AVATAR_UPLOAD_OPTIONS))
  @OperationLog('个人中心', '上传头像')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '上传头像（图片 ≤5MB，落盘后同步 userinfo.avatar）' })
  async uploadAvatar(@CurrentUser() user: AuthUser, @UploadedFile() file: Express.Multer.File) {
    return this.profileService.uploadAvatar(user, file)
  }
}
