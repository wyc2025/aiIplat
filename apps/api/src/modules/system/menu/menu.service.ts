import { Injectable } from '@nestjs/common'
import { ErrorCode } from '../../../common/constants/error-code'
import { RedisKey } from '../../../common/constants/redis-key'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import { RedisService } from '../../../infra/redis/redis.service'
import type { CreateMenuDto, UpdateMenuDto } from './dto/menu.dto'

@Injectable()
export class MenuService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** 菜单列表（平铺，前端组树；管理页用，含全部 type，不按权限过滤） */
  async list() {
    return this.prisma.sysMenu.findMany({
      orderBy: [{ parentId: 'asc' }, { sort: 'asc' }],
    })
  }

  async create(dto: CreateMenuDto) {
    await this.assertParentExists(dto.parentId)
    const menu = await this.prisma.sysMenu.create({
      data: { ...dto, parentId: BigInt(dto.parentId) },
    })
    await this.invalidatePermsByMenu(menu.id)
    return menu
  }

  async update(id: bigint, dto: UpdateMenuDto) {
    await this.assertExists(id)
    if (dto.parentId !== undefined) {
      if (dto.parentId === Number(id)) {
        throw new BusinessException(ErrorCode.ParamInvalid, '父菜单不能是自身')
      }
      await this.assertParentExists(dto.parentId)
    }
    const { parentId, ...fields } = dto
    const menu = await this.prisma.sysMenu.update({
      where: { id },
      data: { ...fields, parentId: parentId !== undefined ? BigInt(parentId) : undefined },
    })
    // 菜单变更影响所有引用它的角色的用户权限
    await this.invalidatePermsByMenu(id)
    return menu
  }

  /** 删除：有子级禁止；同时清理角色-菜单关联并失效相关用户 perms */
  async remove(id: bigint) {
    await this.assertExists(id)
    const children = await this.prisma.sysMenu.count({ where: { parentId: id } })
    if (children > 0) {
      throw new BusinessException(ErrorCode.MenuHasChildren, '存在子菜单，不可删除')
    }
    // 先失效引用该菜单的用户权限，再清理关联
    await this.invalidatePermsByMenu(id)
    await this.prisma.sysRoleMenu.deleteMany({ where: { menuId: id } })
    return this.prisma.sysMenu.delete({ where: { id } })
  }

  /** 失效引用某菜单的所有用户的 perms 缓存 */
  private async invalidatePermsByMenu(menuId: bigint) {
    const roleMenus = await this.prisma.sysRoleMenu.findMany({ where: { menuId } })
    if (roleMenus.length === 0) return
    const roleIds = roleMenus.map((rm) => rm.roleId)
    const userRoles = await this.prisma.sysUserRole.findMany({
      where: { roleId: { in: roleIds } },
    })
    if (userRoles.length === 0) return
    const keys = userRoles.map((ur) => RedisKey.userPerms(ur.userId.toString()))
    await this.redis.client.del(...keys)
  }

  private async assertExists(id: bigint) {
    const menu = await this.prisma.sysMenu.findUnique({ where: { id } })
    if (!menu) throw new BusinessException(ErrorCode.NotFound, '菜单不存在')
    return menu
  }

  private async assertParentExists(parentId: number) {
    if (parentId === 0) return
    const parent = await this.prisma.sysMenu.findUnique({ where: { id: BigInt(parentId) } })
    if (!parent) throw new BusinessException(ErrorCode.NotFound, '父菜单不存在')
    // 按钮下不能再挂子级
    if (parent.type === 3) {
      throw new BusinessException(ErrorCode.ParamInvalid, '按钮类型下不能新增子菜单')
    }
  }
}
