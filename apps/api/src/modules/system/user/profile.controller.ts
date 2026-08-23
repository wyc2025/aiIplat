import { Body, Controller, Put } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../../gateway/decorators/current-user.decorator'
import { OperationLog } from '../../../gateway/decorators/operation-log.decorator'
import type { AuthUser } from '../../../gateway/guards/jwt.strategy'
import { ChangePasswordDto, UpdateProfileDto } from './dto/profile.dto'
import { UserService } from './user.service'

/** 个人中心：登录用户自服务接口（只操作自己，无需管理端权限标识） */
@ApiTags('个人中心')
@ApiBearerAuth()
@Controller('system/user/profile')
export class ProfileController {
  constructor(private readonly userService: UserService) {}

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
}
