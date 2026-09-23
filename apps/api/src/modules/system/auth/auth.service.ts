import { randomUUID } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import type { SysMenu, SysRole } from '@prisma/client'
import bcrypt from 'bcrypt'
import { ErrorCode } from '../../../common/constants/error-code'
import { RedisKey } from '../../../common/constants/redis-key'
import { BusinessException } from '../../../common/exceptions/business.exception'
import type { AuthUser } from '../../../gateway/guards/jwt.strategy'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import { RedisService } from '../../../infra/redis/redis.service'
import { AppFacade } from '../../app/facade/app-facade.service'
import type { LoginDto, TokenPairDto } from './dto/login.dto'
import type { RefreshDto } from './dto/refresh.dto'
import { MenuTreeNode, type UserInfoResult } from './vo/userinfo.vo'

/** 登录失败锁定规则（PRD 6.7）：连续失败 5 次锁定 10 分钟 */
const LOGIN_FAIL_LIMIT = 5
const LOGIN_LOCK_SECONDS = 600
/** 在线状态滑动过期时间（30 分钟，见 ARCHITECTURE §H） */
const ONLINE_TTL_SECONDS = 1800

interface RefreshPayload {
  sub: string
  username: string
  jti: string
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly appFacade: AppFacade,
  ) {}

  /** 登录：校验锁定 → 校验账号密码 → 签发双 token 并缓存权限标识 */
  async login(dto: LoginDto, ip?: string, userAgent?: string): Promise<TokenPairDto> {
    const { username, password } = dto
    const failKey = RedisKey.loginFail(username)

    // 1. 锁定检查：计数达到上限即拒绝，提示剩余锁定时间
    const failCount = Number((await this.redis.client.get(failKey)) ?? 0)
    if (failCount >= LOGIN_FAIL_LIMIT) {
      const ttl = Math.max(await this.redis.client.ttl(failKey), 0)
      void this.writeLoginLog(username, ip, 0, '账号已锁定', userAgent)
      throw new BusinessException(ErrorCode.AccountLocked, `账号已锁定，请 ${ttl} 秒后重试`)
    }

    // 2. 校验用户与密码（用户不存在与密码错误统一提示，防止账号枚举）
    const user = await this.prisma.sysUser.findFirst({
      where: { username, deletedAt: null },
      include: { userRoles: { include: { role: true } } },
    })
    if (!user || !(await bcrypt.compare(password, user.password))) {
      await this.incrLoginFail(failKey)
      void this.writeLoginLog(username, ip, 0, '用户名或密码错误', userAgent)
      throw new BusinessException(ErrorCode.InvalidCredentials, '用户名或密码错误')
    }
    if (user.status !== 1) {
      void this.writeLoginLog(username, ip, 0, '账号已禁用', userAgent)
      throw new BusinessException(ErrorCode.AccountDisabled, '账号已禁用，请联系管理员')
    }

    // 3. 登录成功：清失败计数、记录登录信息、写在线状态、签发 token、刷新权限缓存
    await this.redis.client.del(failKey)
    await this.prisma.sysUser.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), lastLoginIp: ip ?? null },
    })
    void this.writeLoginLog(username, ip, 1, '登录成功', userAgent)
    await this.markOnline(user.id.toString(), user.username, user.nickname, ip)
    const activeRoles = this.filterActiveRoles(user.userRoles.map((ur) => ur.role))
    await this.refreshPermsCache(user.id, activeRoles)
    return this.issueTokenPair(user.id.toString(), user.username)
  }

  /** 刷新 token：校验签名 + Redis 存在性 → rotation（旧 refresh 立即失效，签发新 token 对） */
  async refresh(dto: RefreshDto): Promise<TokenPairDto> {
    let payload: RefreshPayload
    try {
      payload = await this.jwtService.verifyAsync<RefreshPayload>(dto.refreshToken, {
        secret: this.config.getOrThrow<string>('jwt.refreshSecret'),
      })
    } catch {
      throw new BusinessException(ErrorCode.InvalidRefreshToken, 'refresh token 无效或已过期')
    }

    const refreshKey = RedisKey.refresh(payload.sub, payload.jti)
    if (!(await this.redis.client.exists(refreshKey))) {
      throw new BusinessException(ErrorCode.InvalidRefreshToken, 'refresh token 无效或已过期')
    }

    // 禁用用户的已签发 token 自然过期（第一期不做实时踢下线），故此处不校验用户状态；
    // 仅当用户仍存在时顺带刷新权限缓存，保证会话期间权限守卫可用
    await this.redis.client.del(refreshKey)
    const dbUser = await this.prisma.sysUser.findFirst({
      where: { id: BigInt(payload.sub), deletedAt: null },
      include: { userRoles: { include: { role: true } } },
    })
    if (dbUser) {
      await this.refreshPermsCache(dbUser.id, this.filterActiveRoles(dbUser.userRoles.map((ur) => ur.role)))
    }
    return this.issueTokenPair(payload.sub, payload.username)
  }

  /** 登出：access jti 加入黑名单（TTL = 剩余有效期）+ 删除对应 refresh token + 删除在线状态 */
  async logout(user: AuthUser): Promise<void> {
    const blacklistTtl = user.exp - Math.floor(Date.now() / 1000)
    const pipeline = this.redis.client.pipeline()
    if (blacklistTtl > 0) {
      pipeline.set(RedisKey.tokenBlacklist(user.jti), '1', 'EX', blacklistTtl)
    }
    pipeline.del(RedisKey.refresh(user.userId, user.jti))
    pipeline.del(RedisKey.online(user.userId))
    await pipeline.exec()
  }

  /** 用户基础信息 + 角色标识 + 权限标识 + 权限过滤后的菜单树 */
  async getUserInfo(userId: string): Promise<UserInfoResult> {
    const user = await this.prisma.sysUser.findFirst({
      where: { id: BigInt(userId), deletedAt: null },
      include: { userRoles: { include: { role: true } }, dept: true },
    })
    if (!user) {
      throw new BusinessException(ErrorCode.Unauthorized, '用户不存在或已删除')
    }

    const activeRoles = this.filterActiveRoles(user.userRoles.map((ur) => ur.role))
    const roles = activeRoles.map((role) => role.code)
    const isSuperAdmin = roles.includes('admin')

    const perms = await this.refreshPermsCache(user.id, activeRoles)
    const menus = await this.loadMenus(activeRoles, isSuperAdmin)

    // 剔除敏感字段与关联中间表
    const { password: _password, userRoles: _userRoles, ...userInfo } = user
    const tree = this.buildMenuTree(menus)
    await this.appendAppMenuSegment(tree, user.id)
    return { user: userInfo, roles, perms, menus: tree }
  }

  /**
   * R96：把「应用中心」节点的 children 追加为**实时动态段**（不落 sys_menu）：
   *   应用中心 ▸ {应用名}(type=1) ▸ {功能页名}(type=2)
   * 前端静态注册通配路由 `/app-center/app/:appCode/p/:pageCode`，菜单只驱动跳转；
   * 功能页 component 留空（dynamic.ts 对空 component 跳过路由注册，不产生重复路由）。
   * 应用删除/转草稿后，下次拉 userinfo 即时消失（零种子依赖，W1 教训的正面利用）。
   */
  private async appendAppMenuSegment(tree: MenuTreeNode[], userId: bigint): Promise<void> {
    const center = tree.find((node) => node.path === '/app-center')
    if (!center) return
    const segments = await this.appFacade.getAppMenuSegments(userId)
    if (segments.length === 0) return
    const children = [...(center.children ?? [])]
    segments.forEach((segment, appIndex) => {
      const appNodeId = `dyn-app-${segment.appCode}`
      children.push({
        id: appNodeId,
        parentId: center.id,
        name: segment.name,
        type: 1,
        path: `/app-center/app/${segment.appCode}`,
        component: null,
        perms: null,
        icon: 'Grid',
        sort: 100 + appIndex,
        visible: 1,
        children: segment.pages.map((page, pageIndex) => ({
          id: `${appNodeId}-${page.code}`,
          parentId: appNodeId,
          name: page.name,
          type: 2,
          path: `/app-center/app/${segment.appCode}/p/${page.code}`,
          component: null,
          perms: null,
          icon: null,
          sort: pageIndex + 1,
          visible: 1,
          children: [],
        })),
      })
    })
    center.children = children
  }

  /** 过滤出启用且未删除的角色 */
  private filterActiveRoles(roles: SysRole[]): SysRole[] {
    return roles.filter((role) => role.status === 1 && !role.deletedAt)
  }

  /** 签发 access + refresh token 对（共用同一 jti 作为会话标识），并登记 refresh 到 Redis */
  private async issueTokenPair(userId: string, username: string): Promise<TokenPairDto> {
    const accessExpiresIn = this.parseDurationToSeconds(this.config.get<string>('jwt.accessExpires', '2h'))
    const refreshExpiresIn = this.parseDurationToSeconds(this.config.get<string>('jwt.refreshExpires', '7d'))
    const jti = randomUUID()
    const payload = { sub: userId, username, jti }

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.config.getOrThrow<string>('jwt.accessSecret'),
        expiresIn: accessExpiresIn,
      }),
      this.jwtService.signAsync(payload, {
        secret: this.config.getOrThrow<string>('jwt.refreshSecret'),
        expiresIn: refreshExpiresIn,
      }),
    ])
    await this.redis.client.set(RedisKey.refresh(userId, jti), '1', 'EX', refreshExpiresIn)
    return { accessToken, refreshToken, expiresIn: accessExpiresIn }
  }

  /** 计算用户权限标识集合并写入 Redis（超管为 ['*']），登录与 userinfo 时调用 */
  private async refreshPermsCache(userId: bigint, roles: SysRole[]): Promise<string[]> {
    let perms: string[]
    if (roles.some((role) => role.code === 'admin')) {
      perms = ['*']
    } else {
      const roleMenus = await this.prisma.sysRoleMenu.findMany({
        where: { roleId: { in: roles.map((role) => role.id) } },
        include: { menu: true },
      })
      perms = [
        ...new Set(
          roleMenus
            .map((rm) => rm.menu)
            // 菜单级（type=2）perms 同样计入权限集合：如 site:site:manage 挂在"站点设置"菜单上，
            // 该页全部接口以它鉴权；仅收按钮（type=3）会导致 common 用户 40300（T40 联调发现）
            .filter((menu) => menu.status === 1 && (menu.type === 2 || menu.type === 3) && menu.perms)
            .map((menu) => menu.perms as string),
        ),
      ]
    }
    // TTL 与 refresh token 一致，保证会话有效期内权限守卫可用；角色/菜单变更由 T5 主动失效
    await this.redis.client.set(
      RedisKey.userPerms(userId.toString()),
      JSON.stringify(perms),
      'EX',
      this.parseDurationToSeconds(this.config.get<string>('jwt.refreshExpires', '7d')),
    )
    return perms
  }

  /** 加载用户可见菜单（type=1 目录 / 2 菜单，status=1；visible=0 的也返回，由前端决定是否进侧边栏） */
  private async loadMenus(roles: SysRole[], isSuperAdmin: boolean): Promise<SysMenu[]> {
    if (isSuperAdmin) {
      return this.prisma.sysMenu.findMany({
        where: { status: 1, type: { in: [1, 2] } },
        orderBy: { sort: 'asc' },
      })
    }
    const roleMenus = await this.prisma.sysRoleMenu.findMany({
      where: { roleId: { in: roles.map((role) => role.id) } },
      include: { menu: true },
    })
    const menus = roleMenus
      .map((rm) => rm.menu)
      .filter((menu) => menu.status === 1 && (menu.type === 1 || menu.type === 2))
    // 多角色可能关联同一菜单，按 id 去重后排序
    return [...new Map(menus.map((menu) => [menu.id.toString(), menu])).values()].sort(
      (a, b) => a.sort - b.sort,
    )
  }

  /** 平铺菜单组树（按 parentId 递归，同级按 sort 排序） */
  private buildMenuTree(menus: SysMenu[], parentId: bigint = BigInt(0)): MenuTreeNode[] {
    return menus
      .filter((menu) => menu.parentId === parentId)
      .sort((a, b) => a.sort - b.sort)
      .map((menu) => ({
        id: menu.id.toString(),
        parentId: menu.parentId.toString(),
        name: menu.name,
        type: menu.type,
        path: menu.path,
        component: menu.component,
        perms: menu.perms,
        icon: menu.icon,
        sort: menu.sort,
        visible: menu.visible,
        children: this.buildMenuTree(menus, menu.id),
      }))
  }

  /** 登录失败计数 +1（首次失败开启 10 分钟计数窗口） */
  private async incrLoginFail(failKey: string): Promise<void> {
    const count = await this.redis.client.incr(failKey)
    if (count === 1) {
      await this.redis.client.expire(failKey, LOGIN_LOCK_SECONDS)
    }
  }

  /** 写登录日志（异步，失败只记运行日志） */
  private async writeLoginLog(
    username: string,
    ip: string | undefined,
    status: number,
    message: string,
    userAgent?: string,
  ): Promise<void> {
    try {
      const { browser, os } = this.parseUserAgent(userAgent)
      await this.prisma.sysLoginLog.create({
        data: { username, ip: ip ?? null, browser, os, status, message },
      })
    } catch (error) {
      // 登录日志失败不阻断登录流程
      console.error('登录日志落库失败', error instanceof Error ? error.message : String(error))
    }
  }

  /** 粗略解析 User-Agent 提取浏览器与操作系统 */
  private parseUserAgent(ua?: string): { browser: string | null; os: string | null } {
    if (!ua) return { browser: null, os: null }
    let browser: string | null = null
    if (/Edg\//.test(ua)) browser = 'Edge'
    else if (/Chrome\//.test(ua)) browser = 'Chrome'
    else if (/Firefox\//.test(ua)) browser = 'Firefox'
    else if (/Safari\//.test(ua)) browser = 'Safari'
    let os: string | null = null
    if (/Windows/.test(ua)) os = 'Windows'
    else if (/Mac OS X/.test(ua)) os = 'macOS'
    else if (/Linux/.test(ua)) os = 'Linux'
    else if (/Android/.test(ua)) os = 'Android'
    else if (/iPhone|iPad/.test(ua)) os = 'iOS'
    return { browser, os }
  }

  /** 把 '2h' / '7d' 形式的时长解析为秒数（纯数字按秒处理） */
  private parseDurationToSeconds(duration: string): number {
    const match = /^(\d+)([smhd])$/.exec(duration)
    if (!match) return Number(duration) || 0
    const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 }
    return Number(match[1]) * multipliers[match[2]]
  }

  /** 写在线状态（登录时）：online:{userId} hash，30 分钟滑动过期 */
  private async markOnline(userId: string, username: string, nickname: string, ip?: string): Promise<void> {
    const now = new Date()
    await this.redis.client.hset(
      RedisKey.online(userId),
      'username',
      username,
      'nickname',
      nickname,
      'ip',
      ip ?? '',
      'loginAt',
      now.toISOString(),
      'lastActiveAt',
      now.toISOString(),
    )
    await this.redis.client.expire(RedisKey.online(userId), ONLINE_TTL_SECONDS)
  }
}
