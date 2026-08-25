import type { UserService } from '../../../system/user/user.service'
import type { AiTool } from '../tool.types'

/** 查询当前用户自己的资料（read，登录即可） */
export function createGetMyProfileTool(userService: UserService): AiTool {
  return {
    name: 'get_my_profile',
    title: '查询我的资料',
    description: '查询当前登录用户自己的资料（用户名、昵称、邮箱、手机号、性别、角色）',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    risk: 'read',
    handler: async (ctx) => {
      const user = await userService.findById(BigInt(ctx.user.userId))
      return {
        username: user.username,
        nickname: user.nickname,
        email: user.email,
        phone: user.phone,
        gender: user.gender,
        roles: user.roles.map((r: { id: bigint; name: string; code: string }) => ({
          id: r.id.toString(),
          name: r.name,
          code: r.code,
        })),
      }
    },
  }
}
