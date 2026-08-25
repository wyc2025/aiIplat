import type { UserService } from '../../../system/user/user.service'
import type { AiTool } from '../tool.types'

/** 修改当前用户自己的资料（write，登录即可；仅限 nickname/email/phone/gender，userId 强制当前登录人） */
export function createUpdateMyProfileTool(userService: UserService): AiTool {
  return {
    name: 'update_my_profile',
    title: '修改我的资料',
    description: '修改当前登录用户自己的资料，仅限昵称、邮箱、手机号、性别四项',
    parameters: {
      type: 'object',
      properties: {
        nickname: { type: 'string', description: '昵称' },
        email: { type: 'string', description: '邮箱' },
        phone: { type: 'string', description: '手机号' },
        gender: { type: 'integer', enum: [0, 1, 2], description: '性别：0 未知 1 男 2 女' },
      },
      additionalProperties: false,
    },
    risk: 'write',
    handler: async (ctx, params) => {
      const userId = BigInt(ctx.user.userId)
      // 白名单过滤：仅允许这四项
      const allowed = ['nickname', 'email', 'phone', 'gender'] as const
      const data: Record<string, unknown> = {}
      for (const key of allowed) {
        if (params[key] !== undefined) data[key] = params[key]
      }
      if (Object.keys(data).length === 0) {
        return { success: false, message: '未提供任何可修改的字段' }
      }
      // nickname 必填约束：未传时用当前昵称兜底
      const current = await userService.findById(userId)
      await userService.updateProfile(userId, {
        nickname: (data.nickname as string) ?? current.nickname,
        ...(data.email !== undefined ? { email: data.email as string } : {}),
        ...(data.phone !== undefined ? { phone: data.phone as string } : {}),
        ...(data.gender !== undefined ? { gender: data.gender as number } : {}),
      })
      return { success: true }
    },
  }
}
