import { ErrorCode } from '../../../../common/constants/error-code'
import { BusinessException } from '../../../../common/exceptions/business.exception'
import type { OnlineService } from '../../../system/online/online.service'
import type { UserService } from '../../../system/user/user.service'
import type { AiTool } from '../tool.types'

/** 踢用户下线（write，绑定 system:online:kick；参数 username） */
export function createKickUserTool(onlineService: OnlineService, userService: UserService): AiTool {
  return {
    name: 'kick_user',
    description: '将指定用户踢下线（强制其所有端重新登录）。参数为用户名，admin 与本人不可踢',
    parameters: {
      type: 'object',
      properties: {
        username: { type: 'string', description: '要踢下线的用户名' },
      },
      required: ['username'],
      additionalProperties: false,
    },
    perms: 'system:online:kick',
    risk: 'write',
    handler: async (ctx, params) => {
      const username = String(params.username ?? '')
      if (!username) throw new BusinessException(ErrorCode.ParamInvalid, '缺少用户名参数')
      const target = await userService.findByUsername(username)
      if (!target) throw new BusinessException(ErrorCode.NotFound, '用户不存在')
      await onlineService.kick(target.id, ctx.user.userId)
      return { success: true, username }
    },
  }
}
