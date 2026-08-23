import { Injectable } from '@nestjs/common'
import { ErrorCode } from '../../../common/constants/error-code'
import { PageResultDto } from '../../../common/dto/page-result.dto'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import type {
  CreateDictDataDto,
  CreateDictTypeDto,
  DictTypeQueryDto,
  UpdateDictDataDto,
  UpdateDictTypeDto,
} from './dto/dict.dto'

@Injectable()
export class DictService {
  constructor(private readonly prisma: PrismaService) {}

  // ========== 字典类型 ==========

  async typePage(query: DictTypeQueryDto) {
    const where = query.name ? { name: { contains: query.name } } : {}
    const [list, total] = await Promise.all([
      this.prisma.sysDictType.findMany({
        where,
        orderBy: { id: 'asc' },
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.sysDictType.count({ where }),
    ])
    return new PageResultDto(list, total, query)
  }

  async createType(dto: CreateDictTypeDto) {
    const exists = await this.prisma.sysDictType.findUnique({ where: { type: dto.type } })
    if (exists) throw new BusinessException(ErrorCode.DictTypeExists, '字典类型标识已存在')
    return this.prisma.sysDictType.create({ data: dto })
  }

  async updateType(id: bigint, dto: UpdateDictTypeDto) {
    await this.assertTypeExists(id)
    return this.prisma.sysDictType.update({ where: { id }, data: dto })
  }

  /** 删除类型：下有数据禁止 */
  async removeType(id: bigint) {
    await this.assertTypeExists(id)
    const dataCount = await this.prisma.sysDictData.count({ where: { typeId: id } })
    if (dataCount > 0) {
      throw new BusinessException(ErrorCode.DictTypeHasData, '字典类型下存在数据，不可删除')
    }
    return this.prisma.sysDictType.delete({ where: { id } })
  }

  // ========== 字典数据 ==========

  /** 某类型下的字典数据（列表，不分页） */
  async dataList(typeId: bigint) {
    await this.assertTypeExists(typeId)
    return this.prisma.sysDictData.findMany({
      where: { typeId },
      orderBy: { sort: 'asc' },
    })
  }

  /** 按类型标识取启用中的字典数据（前端 useDict 用，如 sys_user_gender） */
  async dataByType(type: string) {
    const dictType = await this.prisma.sysDictType.findUnique({ where: { type } })
    if (!dictType) return []
    return this.prisma.sysDictData.findMany({
      where: { typeId: dictType.id, status: 1 },
      orderBy: { sort: 'asc' },
      select: { label: true, value: true },
    })
  }

  async createData(dto: CreateDictDataDto) {
    const typeId = BigInt(dto.typeId)
    await this.assertTypeExists(typeId)
    return this.prisma.sysDictData.create({ data: { ...dto, typeId } })
  }

  async updateData(id: bigint, dto: UpdateDictDataDto) {
    await this.assertDataExists(id)
    return this.prisma.sysDictData.update({ where: { id }, data: dto })
  }

  async removeData(id: bigint) {
    await this.assertDataExists(id)
    return this.prisma.sysDictData.delete({ where: { id } })
  }

  private async assertTypeExists(id: bigint) {
    const type = await this.prisma.sysDictType.findUnique({ where: { id } })
    if (!type) throw new BusinessException(ErrorCode.NotFound, '字典类型不存在')
    return type
  }

  private async assertDataExists(id: bigint) {
    const data = await this.prisma.sysDictData.findUnique({ where: { id } })
    if (!data) throw new BusinessException(ErrorCode.NotFound, '字典数据不存在')
    return data
  }
}
