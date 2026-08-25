import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ErrorCode } from '../../common/constants/error-code'
import { BusinessException } from '../../common/exceptions/business.exception'
import { PERMISSION_KEY } from '../decorators/require-permission.decorator'
import { PermissionService } from '../services/permission.service'
import type { AuthUser } from './jwt.strategy'

/**
 * 全局权限守卫：接口无 @RequirePermission() 则跳过；
 * 权限判定复用 PermissionService（gateway 层共用，工具层同源）。
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionService: PermissionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (!required || required.length === 0) return true

    const request = context.switchToHttp().getRequest<{ user?: AuthUser }>()
    const user = request.user
    if (!user) {
      throw new BusinessException(ErrorCode.Unauthorized, '未登录或登录已过期')
    }

    const allowed = await this.permissionService.hasAnyPermission(user.userId, required)
    if (allowed) return true

    throw new BusinessException(ErrorCode.Forbidden, '无权限访问')
  }
}
