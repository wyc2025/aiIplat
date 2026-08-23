import { Body, Controller, Get, Headers, Ip, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { CurrentUser } from '../../../gateway/decorators/current-user.decorator'
import { Public } from '../../../gateway/decorators/public.decorator'
import type { AuthUser } from '../../../gateway/guards/jwt.strategy'
import { AuthService } from './auth.service'
import { LoginDto } from './dto/login.dto'
import { RefreshDto } from './dto/refresh.dto'

@ApiTags('认证')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @ApiOperation({ summary: '登录（双 token，失败 5 次锁定 10 分钟）' })
  login(@Body() dto: LoginDto, @Ip() ip: string, @Headers('user-agent') userAgent?: string) {
    return this.authService.login(dto, ip, userAgent)
  }

  @Public()
  @Post('refresh')
  @ApiOperation({ summary: '刷新 token（rotation：旧 refresh 立即失效）' })
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto)
  }

  @Post('logout')
  @ApiBearerAuth()
  @ApiOperation({ summary: '登出（access 加入黑名单 + 删除 refresh）' })
  logout(@CurrentUser() user: AuthUser) {
    return this.authService.logout(user)
  }

  @Get('userinfo')
  @ApiBearerAuth()
  @ApiOperation({ summary: '当前用户信息（用户 + 角色 + 权限标识 + 菜单树）' })
  getUserInfo(@CurrentUser('userId') userId: string) {
    return this.authService.getUserInfo(userId)
  }
}
