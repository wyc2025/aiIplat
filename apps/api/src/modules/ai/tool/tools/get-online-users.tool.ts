import type { OnlineService } from '../../../system/online/online.service'
import type { AiTool } from '../tool.types'

/** 查询在线用户列表与数量（read，绑定 system:online:list） */
export function createGetOnlineUsersTool(onlineService: OnlineService): AiTool {
  return {
    name: 'get_online_users',
    title: '查询在线用户',
    description: '查询当前在线的用户列表与数量（含用户名、昵称、登录 IP、登录时间、最后活跃时间）',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    perms: 'system:online:list',
    risk: 'read',
    handler: async () => {
      const users = await onlineService.list()
      return { count: users.length, users }
    },
  }
}
