import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ErrorCode } from '../../../common/constants/error-code'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import type { FileListQueryDto, MkdirDto, RenameDto } from './dto/file.dto'

/** 目录深度上限（R6） */
const MAX_DEPTH = 10
/** 单目录直接子项上限（R6；TransferService 上传计数复用，故导出） */
export const MAX_CHILDREN = 500

@Injectable()
export class FileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** 目录内容列表：文件夹在前（名称升序），文件在后（修改时间倒序），不分页 */
  async list(userId: bigint, query: FileListQueryDto) {
    const parentId = BigInt(query.parentId ?? 0)
    // 父目录归属校验（根目录跳过）
    if (parentId !== BigInt(0)) {
      await this.assertOwned(parentId, userId, false)
    }

    const children = await this.prisma.cloudFile.findMany({
      where: { userId, parentId, deletedAt: null },
    })
    const dirs = children
      .filter((f) => f.isDir === 1)
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
    const files = children
      .filter((f) => f.isDir === 0)
      .sort((a, b) => b.updateTime.getTime() - a.updateTime.getTime())

    const list = [...dirs, ...files].map((f) => ({
      id: f.id,
      name: f.name,
      isDir: f.isDir,
      size: f.size,
      ext: f.ext,
      mime: f.mime,
      updateTime: f.updateTime,
    }))

    const { quota, used } = await this.getQuota(userId)
    return { list, quota, used }
  }

  /** 面包屑链：从根到当前目录（含当前自身，不含根"我的文件"），根目录返回 [] */
  async path(userId: bigint, id: bigint) {
    if (id === BigInt(0)) return []
    const chain: Array<{ id: bigint; name: string }> = []
    let current = await this.assertOwned(id, userId, false)
    // 上溯到根（parent_id=0 停止），最多 MAX_DEPTH 层防环；先装自身，再逐级向上
    chain.unshift({ id: current.id, name: current.name })
    while (current.parentId !== BigInt(0) && chain.length < MAX_DEPTH) {
      current = await this.assertOwned(current.parentId, userId, false)
      chain.unshift({ id: current.id, name: current.name })
    }
    return chain
  }

  /** 新建文件夹：深度/数量限制 + 同名自动"(1)" */
  async mkdir(userId: bigint, dto: MkdirDto) {
    const parentId = BigInt(dto.parentId)
    if (parentId !== BigInt(0)) {
      await this.assertOwned(parentId, userId, true)
    }

    // 深度限制：当前目录深度已达上限则拒绝（新目录深度 = 父深度 + 1）
    const depth = await this.computeDepth(parentId, userId)
    if (depth + 1 > MAX_DEPTH) {
      throw new BusinessException(ErrorCode.CloudDirLimitExceeded, '目录深度不能超过 10 层')
    }

    // 数量限制
    const count = await this.prisma.cloudFile.count({
      where: { userId, parentId, deletedAt: null },
    })
    if (count >= MAX_CHILDREN) {
      throw new BusinessException(ErrorCode.CloudDirLimitExceeded, '单个目录下子项不能超过 500 个')
    }

    // 同名冲突：自动追加 "(1)"、"(2)"
    const name = await this.resolveNameConflict(userId, parentId, dto.name)

    const created = await this.prisma.cloudFile.create({
      data: { userId, parentId, name, isDir: 1, size: BigInt(0) },
    })
    return { id: created.id.toString(), name }
  }

  /** 重命名：同名冲突阻止（30002） */
  async rename(userId: bigint, dto: RenameDto) {
    const id = BigInt(dto.id)
    const target = await this.assertOwned(id, userId, false)
    if (target.name === dto.name) {
      return { id: id.toString(), name: target.name }
    }
    // 同目录下同名（排除自身、排除回收站项）
    const conflict = await this.prisma.cloudFile.findFirst({
      where: { userId, parentId: target.parentId, name: dto.name, deletedAt: null, NOT: { id } },
    })
    if (conflict) {
      throw new BusinessException(ErrorCode.CloudNameConflict, '同目录下已存在同名项')
    }
    const updated = await this.prisma.cloudFile.update({
      where: { id },
      data: { name: dto.name },
    })
    return { id: updated.id.toString(), name: updated.name }
  }

  /** 删除：软删入回收站（R2：只标记自身，后代不变） */
  async remove(userId: bigint, id: bigint) {
    await this.assertOwned(id, userId, false)
    await this.prisma.cloudFile.update({
      where: { id },
      data: { deletedAt: new Date() },
    })
    return { success: true }
  }

  /** 我的配额（cloud_usage 懒创建） */
  async getQuota(userId: bigint) {
    let usage = await this.prisma.cloudUsage.findUnique({ where: { userId } })
    if (!usage) {
      const defaultQuota = this.config.get<number>('upload.cloudDefaultQuota', 1024 * 1024 * 1024)
      usage = await this.prisma.cloudUsage.upsert({
        where: { userId },
        update: {},
        create: { userId, quota: BigInt(defaultQuota), used: BigInt(0) },
      })
    }
    return { quota: usage.quota, used: usage.used }
  }

  /** 校验目标项归属当前用户且未删除；isDir 校验可强制要求文件夹（TransferService 上传/预览复用） */
  async assertOwned(id: bigint, userId: bigint, mustBeDir: boolean) {
    const file = await this.prisma.cloudFile.findFirst({
      where: { id, userId, deletedAt: null },
    })
    if (!file) {
      throw new BusinessException(ErrorCode.CloudFileNotFound, '文件/文件夹不存在或无权访问')
    }
    if (mustBeDir && file.isDir !== 1) {
      throw new BusinessException(ErrorCode.CloudFileNotFound, '目标不是文件夹')
    }
    return file
  }

  /** 计算目录深度（根目录深度 = 0），上溯到 parent_id=0 */
  private async computeDepth(id: bigint, userId: bigint): Promise<number> {
    let depth = 0
    let current = id
    // 防环上限 MAX_DEPTH + 1
    for (let i = 0; i <= MAX_DEPTH && current !== BigInt(0); i++) {
      depth++
      const parent = await this.prisma.cloudFile.findFirst({
        where: { id: current, userId, deletedAt: null },
      })
      if (!parent) break
      current = parent.parentId
    }
    return depth
  }

  /** 同名自动重命名：同目录下（未删除项）已存在则追加 "(1)"、"(2)"…（TransferService 上传复用） */
  async resolveNameConflict(userId: bigint, parentId: bigint, name: string): Promise<string> {
    const exists = await this.prisma.cloudFile.findFirst({
      where: { userId, parentId, name, deletedAt: null },
    })
    if (!exists) return name

    // 提取扩展名与主名（文件夹无扩展名概念，直接整体处理）
    const dotIndex = name.lastIndexOf('.')
    const baseName = dotIndex > 0 ? name.slice(0, dotIndex) : name
    const ext = dotIndex > 0 ? name.slice(dotIndex) : ''

    for (let i = 1; i < MAX_CHILDREN; i++) {
      const candidate = `${baseName}(${i})${ext}`
      const conflict = await this.prisma.cloudFile.findFirst({
        where: { userId, parentId, name: candidate, deletedAt: null },
      })
      if (!conflict) return candidate
    }
    // 理论不可达（500 项上限），兜底返回带时间戳的名称
    return `${baseName}(${Date.now()})${ext}`
  }
}
