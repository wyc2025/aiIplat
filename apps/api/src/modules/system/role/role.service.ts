import { Injectable } from '@nestjs/common'
import { ErrorCode } from '../../../common/constants/error-code'
import { RedisKey } from '../../../common/constants/redis-key'
import { PageResultDto } from '../../../common/dto/page-result.dto'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import { RedisService } from '../../../infra/redis/redis.service'
import type { AssignMenuDto, CreateRoleDto, RoleQueryDto, UpdateRoleDto } from './dto/role.dto'

/** 超管角色标识：不可编辑/删除/改菜单（PRD 6.1） */
const ADMIN_ROLE_CODE = 'admin'

@Injectable()
export class RoleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** 分页查询 */
  async page(query: RoleQueryDto) {
    const where = {
      deletedAt: null,
      ...(query.name ? { name: { contains: query.name } } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
    }
    const [list, total] = await Promise.all([
      this.prisma.sysRole.findMany({
        where,
        orderBy: { sort: 'asc' },
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.sysRole.count({ where }),
    ])
    return new PageResultDto(list, total, query)
  }

  /** 全部启用角色（用户分配角色下拉用，不分页） */
  async listAll() {
    return this.prisma.sysRole.findMany({
      where: { deletedAt: null, status: 1 },
      orderBy: { sort: 'asc' },
    })
  }

  async create(dto: CreateRoleDto) {
    const exists = await this.prisma.sysRole.findFirst({
      where: { code: dto.code, deletedAt: null },
    })
    if (exists) throw new BusinessException(ErrorCode.RoleCodeExists, '角色标识已存在')
    return this.prisma.sysRole.create({ data: dto })
  }

  async update(id: bigint, dto: UpdateRoleDto) {
    const role = await this.assertExists(id)
    if (role.code === ADMIN_ROLE_CODE) {
      throw new BusinessException(ErrorCode.AdminRoleProtected, '超管角色不可编辑')
    }
    return this.prisma.sysRole.update({ where: { id }, data: dto })
  }

  /** 删除：被用户引用禁止；超管角色禁止 */
  async remove(id: bigint) {
    const role = await this.assertExists(id)
    if (role.code === ADMIN_ROLE_CODE) {
      throw new BusinessException(ErrorCode.AdminRoleProtected, '超管角色不可删除')
    }
    const used = await this.prisma.sysUserRole.count({ where: { roleId: id } })
    if (used > 0) {
      throw new BusinessException(ErrorCode.RoleInUse, '角色已被用户引用，不可删除')
    }
    // 清理角色-菜单关联后软删除
    await this.prisma.sysRoleMenu.deleteMany({ where: { roleId: id } })
    return this.prisma.sysRole.update({ where: { id }, data: { deletedAt: new Date() } })
  }

  /** 角色已分配的菜单 ID 列表（回显勾选） */
  async getMenuIds(id: bigint) {
    await this.assertExists(id)
    const roleMenus = await this.prisma.sysRoleMenu.findMany({ where: { roleId: id } })
    return roleMenus.map((rm) => rm.menuId.toString())
  }

  /** 分配菜单权限：全量覆盖 + 失效该角色下所有用户的 perms 缓存 */
  async assignMenu(id: bigint, dto: AssignMenuDto) {
    const role = await this.assertExists(id)
    if (role.code === ADMIN_ROLE_CODE) {
      throw new BusinessException(ErrorCode.AdminRoleProtected, '超管角色无需分配菜单')
    }
    const menuIds = [...new Set(dto.menuIds)].map((menuId) => BigInt(menuId))

    await this.prisma.$transaction(async (tx) => {
      await tx.sysRoleMenu.deleteMany({ where: { roleId: id } })
      if (menuIds.length > 0) {
        await tx.sysRoleMenu.createMany({
          data: menuIds.map((menuId) => ({ roleId: id, menuId })),
        })
      }
    })
    await this.invalidatePermsByRole(id)
    return { success: true }
  }

  /** 失效某角色下所有用户的 perms 缓存（角色/菜单变更后调用） */
  private async invalidatePermsByRole(roleId: bigint) {
    const userRoles = await this.prisma.sysUserRole.findMany({ where: { roleId } })
    if (userRoles.length === 0) return
    const keys = userRoles.map((ur) => RedisKey.userPerms(ur.userId.toString()))
    await this.redis.client.del(...keys)
  }

  private async assertExists(id: bigint) {
    const role = await this.prisma.sysRole.findFirst({ where: { id, deletedAt: null } })
    if (!role) throw new BusinessException(ErrorCode.NotFound, '角色不存在')
    return role
  }
}
