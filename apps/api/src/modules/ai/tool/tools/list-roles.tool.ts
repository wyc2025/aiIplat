import type { RoleService } from '../../../system/role/role.service'
import type { AiTool } from '../tool.types'

/** 查询角色列表（read，绑定 system:role:list） */
export function createListRolesTool(roleService: RoleService): AiTool {
  return {
    name: 'list_roles',
    title: '查询角色列表',
    description: '查询系统中的角色列表（含角色名、标识、状态、排序）',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    perms: 'system:role:list',
    risk: 'read',
    handler: async () => {
      const roles = await roleService.listAll()
      return {
        count: roles.length,
        roles: roles.map((r: { id: bigint; name: string; code: string; status: number; sort: number }) => ({
          id: r.id.toString(),
          name: r.name,
          code: r.code,
          status: r.status,
          sort: r.sort,
        })),
      }
    },
  }
}
