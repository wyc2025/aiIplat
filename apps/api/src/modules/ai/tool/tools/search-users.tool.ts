import { UserQueryDto } from '../../../system/user/dto/user.dto'
import type { UserService } from '../../../system/user/user.service'
import type { AiTool } from '../tool.types'

/** 按用户名/状态模糊查询用户列表（read，绑定 system:user:list，返回前 20 条摘要） */
export function createSearchUsersTool(userService: UserService): AiTool {
  return {
    name: 'search_users',
    title: '查询用户',
    description: '按用户名或状态模糊查询用户列表，返回前 20 条摘要（用户名、昵称、状态）',
    parameters: {
      type: 'object',
      properties: {
        username: { type: 'string', description: '用户名关键字（模糊）' },
        status: { type: 'integer', enum: [0, 1], description: '状态：1 启用 0 禁用' },
      },
      additionalProperties: false,
    },
    perms: 'system:user:list',
    risk: 'read',
    handler: async (_ctx, params) => {
      const query = new UserQueryDto()
      query.pageNo = 1
      query.pageSize = 20
      if (params.username) query.username = String(params.username)
      if (params.status !== undefined) query.status = Number(params.status)
      const result = await userService.page(query)
      return {
        total: result.total,
        users: result.list.map((u: { id: bigint; username: string; nickname: string; status: number }) => ({
          id: u.id.toString(),
          username: u.username,
          nickname: u.nickname,
          status: u.status,
        })),
      }
    },
  }
}
