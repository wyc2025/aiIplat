import { SetMetadata } from '@nestjs/common'

export const PERMISSION_KEY = 'requirePermission'

/** 要求权限标识（命名规范 域:模块:操作），传多个表示满足其一即可 */
export const RequirePermission = (...perms: string[]) => SetMetadata(PERMISSION_KEY, perms)
