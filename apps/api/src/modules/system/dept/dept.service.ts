import { Injectable } from '@nestjs/common'
import { ErrorCode } from '../../../common/constants/error-code'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import type { CreateDeptDto, UpdateDeptDto } from './dto/dept.dto'

@Injectable()
export class DeptService {
  constructor(private readonly prisma: PrismaService) {}

  /** 部门列表（平铺，前端组树；status 可选过滤） */
  async list(status?: number) {
    return this.prisma.sysDept.findMany({
      where: { deletedAt: null, ...(status !== undefined ? { status } : {}) },
      orderBy: [{ parentId: 'asc' }, { sort: 'asc' }],
    })
  }

  async create(dto: CreateDeptDto) {
    await this.assertParentExists(dto.parentId)
    return this.prisma.sysDept.create({ data: dto })
  }

  async update(id: bigint, dto: UpdateDeptDto) {
    await this.assertExists(id)
    if (dto.parentId !== undefined) {
      if (dto.parentId === Number(id)) {
        throw new BusinessException(ErrorCode.ParamInvalid, '父部门不能是自身')
      }
      await this.assertParentExists(dto.parentId)
    }
    return this.prisma.sysDept.update({ where: { id }, data: dto })
  }

  /** 删除（软删除）：有子部门或有关联用户时禁止 */
  async remove(id: bigint) {
    await this.assertExists(id)
    const children = await this.prisma.sysDept.count({
      where: { parentId: id, deletedAt: null },
    })
    if (children > 0) {
      throw new BusinessException(ErrorCode.DeptHasChildren, '存在子部门，不可删除')
    }
    const users = await this.prisma.sysUser.count({ where: { deptId: id, deletedAt: null } })
    if (users > 0) {
      throw new BusinessException(ErrorCode.DeptHasUsers, '部门下存在用户，不可删除')
    }
    return this.prisma.sysDept.update({ where: { id }, data: { deletedAt: new Date() } })
  }

  private async assertExists(id: bigint) {
    const dept = await this.prisma.sysDept.findFirst({ where: { id, deletedAt: null } })
    if (!dept) throw new BusinessException(ErrorCode.NotFound, '部门不存在')
  }

  private async assertParentExists(parentId: number) {
    if (parentId === 0) return
    const parent = await this.prisma.sysDept.findFirst({
      where: { id: BigInt(parentId), deletedAt: null },
    })
    if (!parent) throw new BusinessException(ErrorCode.NotFound, '父部门不存在')
  }
}
