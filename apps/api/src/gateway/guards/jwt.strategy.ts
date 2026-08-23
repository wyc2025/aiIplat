import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'

/** 请求上下文中的登录用户信息（由 JWT payload 转换而来） */
export interface AuthUser {
  /** 用户 ID（字符串形式，避免 bigint 精度问题） */
  userId: string
  /** 登录名 */
  username: string
  /** token 唯一标识，用于登出黑名单 / 删除 refresh token */
  jti: string
  /** token 签发时间（秒级时间戳），用于密码修改后旧 token 失效判断 */
  iat: number
  /** token 过期时间（秒级时间戳），登出时计算黑名单 TTL */
  exp: number
}

interface JwtPayload {
  sub: string
  username: string
  jti: string
  iat: number
  exp: number
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('jwt.accessSecret'),
    })
  }

  validate(payload: JwtPayload): AuthUser {
    return {
      userId: payload.sub,
      username: payload.username,
      jti: payload.jti,
      iat: payload.iat,
      exp: payload.exp,
    }
  }
}
