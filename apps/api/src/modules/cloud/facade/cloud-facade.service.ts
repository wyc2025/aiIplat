import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import { FileService, AVATAR_PARENT_ID } from '../file/file.service'

/** 头像元数据（由调用方经 StorageService 落盘后传入） */
export interface AvatarMeta {
  size: bigint
  ext: string
  mime: string
  storageName: string
}

/**
 * 云盘域门面：跨域（system 等）只通过本门面与 cloud 交互，禁止直接 import 内部 FileService（R6）。
 * 封装：删用户预检 hasFiles、头像记录登记 saveAvatar。
 */
@Injectable()
export class CloudFacade {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly fileService: FileService,
  ) {}

  /** 用户是否仍有云盘文件（含头像）；删除用户前预检（R10） */
  async hasFiles(userId: bigint): Promise<boolean> {
    return this.fileService.hasFiles(userId)
  }

  /**
   * 登记新头像：软删旧头像记录并回退 used，新建记录并累加 used。
   * 返回头像可访问 url（指向 cloud 域头像预览端点，前端 img 直接可用）。
   */
  async saveAvatar(userId: bigint, meta: AvatarMeta): Promise<string> {
    // 回退旧头像占用
    const old = await this.prisma.cloudFile.findFirst({
      where: { userId, parentId: AVATAR_PARENT_ID, deletedAt: null },
      orderBy: { id: 'desc' },
    })
    if (old) {
      await this.prisma.cloudFile.update({
        where: { id: old.id },
        data: { deletedAt: new Date() },
      })
      await this.adjustUsed(userId, -old.size)
    }
    const created = await this.prisma.cloudFile.create({
      data: {
        userId,
        parentId: AVATAR_PARENT_ID,
        name: `avatar-${Date.now()}${meta.ext}`,
        isDir: 0,
        size: meta.size,
        ext: meta.ext,
        mime: meta.mime,
        storageName: meta.storageName,
      },
    })
    await this.adjustUsed(userId, meta.size)
    // 头像预览端点归属 cloud 域，url 由 cloud 域统一构造
    return `/api/cloud/file/avatar/${created.id.toString()}`
  }

  /** 调整 cloud_usage.used（懒创建保底），支持负回退 */
  private async adjustUsed(userId: bigint, delta: bigint) {
    const usage = await this.prisma.cloudUsage.findUnique({ where: { userId } })
    if (!usage) {
      const defaultQuota = BigInt(this.config.get<number>('upload.cloudDefaultQuota', 1024 * 1024 * 1024))
      await this.prisma.cloudUsage.create({
        data: { userId, quota: defaultQuota, used: delta > BigInt(0) ? delta : BigInt(0) },
      })
      return
    }
    const next = usage.used + delta
    await this.prisma.cloudUsage.update({
      where: { userId },
      data: { used: next < BigInt(0) ? BigInt(0) : next },
    })
  }
}
