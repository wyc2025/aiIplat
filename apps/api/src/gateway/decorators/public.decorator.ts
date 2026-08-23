import { SetMetadata } from '@nestjs/common'

export const IS_PUBLIC_KEY = 'isPublic'

/** 标记接口为公开，跳过 JwtAuthGuard（如登录、刷新 token） */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true)
