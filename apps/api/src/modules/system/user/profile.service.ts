import { Injectable } from '@nestjs/common'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { ErrorCode } from '../../../common/constants/error-code'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import { StorageService } from '../../../infra/storage/storage.service'
import { CloudFacade } from '../../cloud/facade/cloud-facade.service'
import type { AuthUser } from '../../../gateway/guards/jwt.strategy'

/** 头像大小上限 5MB（T30） */
const MAX_AVATAR_SIZE = 5 * 1024 * 1024
/** 允许的图片 MIME（白名单，防非图片上传） */
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/svg+xml',
])

@Injectable()
export class ProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly cloud: CloudFacade,
  ) {}

  /**
   * 上传头像：校验图片类型与 ≤5MB，物理落盘后经 CloudFacade 登记（含配额 used 同步），
   * 写回 sys_user.avatar；返回完整可访问 url（前端 img 直接可用）。
   */
  async uploadAvatar(user: AuthUser, file: Express.Multer.File) {
    if (!file) {
      throw new BusinessException(ErrorCode.ParamInvalid, '未接收到文件')
    }
    if (!ALLOWED_MIME.has(file.mimetype)) {
      await this.storage.removeTmp(file.path)
      throw new BusinessException(ErrorCode.ParamInvalid, '头像仅支持图片格式（jpg/png/gif/webp/bmp/svg）')
    }
    if (file.size > MAX_AVATAR_SIZE) {
      await this.storage.removeTmp(file.path)
      throw new BusinessException(ErrorCode.ParamInvalid, '头像大小不可超过 5MB')
    }

    const userId = BigInt(user.userId)
    const ext = (file.originalname.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20)
    // 物理落盘：tmp → 正式区（返回 storage_name）
    const storageName = await this.storage.moveToStorage(file.path, ext)

    // 登记云盘头像记录（含 used 同步、旧头像软删回退）
    const avatar = await this.cloud.saveAvatar(userId, {
      size: BigInt(file.size),
      ext: ext ? `.${ext}` : '',
      mime: file.mimetype,
      storageName,
    })

    // 写回用户头像字段
    await this.prisma.sysUser.update({
      where: { id: userId },
      data: { avatar },
    })

    return { avatar }
  }
}
