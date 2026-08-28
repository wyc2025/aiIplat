import { randomInt } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import bcrypt from 'bcrypt'
import { ErrorCode } from '../../../common/constants/error-code'
import { RedisKey } from '../../../common/constants/redis-key'
import { PageResultDto } from '../../../common/dto/page-result.dto'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { parseDurationToSeconds } from '../../../common/utils/duration'
import type { AuthUser } from '../../../gateway/guards/jwt.strategy'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import { RedisService } from '../../../infra/redis/redis.service'
import { CloudFacade } from '../../cloud/facade/cloud-facade.service'
import type {
  AssignRoleDto,
  CreateUserDto,
  UpdateStatusDto,
  UpdateUserDto,
  UserQueryDto,
} from './dto/user.dto'
import type { ChangePasswordDto, UpdateProfileDto } from './dto/profile.dto'

/** admin 用户名：不可禁用/删除/改角色（PRD 6.1） */
const ADMIN_USERNAME = 'admin'

@Injectable()
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly cloud: CloudFacade,
  ) {}

  /** 分页查询（含部门、角色；剔除 password） */
  async page(query: UserQueryDto) {
    const where = {
      deletedAt: null,
      ...(query.username ? { username: { contains: query.username } } : {}),
      ...(query.phone ? { phone: { contains: query.phone } } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
    }
    const [records, total] = await Promise.all([
      this.prisma.sysUser.findMany({
        where,
        include: {
          dept: { select: { id: true, name: true } },
          userRoles: { include: { role: { select: { id: true, name: true, code: true } } } },
        },
        orderBy: { id: 'asc' },
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.sysUser.count({ where }),
    ])
    const list = records.map(({ password: _p, userRoles, ...user }) => ({
      ...user,
      roles: userRoles.map((ur) => ur.role),
    }))
    return new PageResultDto(list, total, query)
  }

  /** 新增用户（bcrypt 存密码，可同时分配角色） */
  async create(dto: CreateUserDto) {
    const exists = await this.prisma.sysUser.findFirst({
      where: { username: dto.username, deletedAt: null },
    })
    if (exists) throw new BusinessException(ErrorCode.UsernameExists, '用户名已存在')
    if (dto.deptId) await this.assertDeptExists(BigInt(dto.deptId))

    const { roleIds, password, ...fields } = dto
    const passwordHash = await bcrypt.hash(password, 10)
    const user = await this.prisma.sysUser.create({
      data: { ...fields, password: passwordHash, deptId: dto.deptId ? BigInt(dto.deptId) : null },
    })
    if (roleIds?.length) {
      await this.replaceUserRoles(user.id, roleIds)
    }
    return { id: user.id.toString() }
  }

  /** 编辑用户（基本信息，不含用户名/密码/角色） */
  async update(id: bigint, dto: UpdateUserDto) {
    await this.assertExists(id)
    if (dto.deptId) await this.assertDeptExists(BigInt(dto.deptId))
    const { deptId, ...fields } = dto
    await this.prisma.sysUser.update({
      where: { id },
      data: { ...fields, deptId: deptId ? BigInt(deptId) : undefined },
    })
    return { success: true }
  }

  /** 启禁用（admin 不可禁用） */
  async updateStatus(id: bigint, dto: UpdateStatusDto) {
    const user = await this.assertExists(id)
    if (user.username === ADMIN_USERNAME) {
      throw new BusinessException(ErrorCode.AdminProtected, 'admin 用户不可禁用')
    }
    await this.prisma.sysUser.update({ where: { id }, data: { status: dto.status } })
    return { success: true }
  }

  /** 重置密码：重置为随机 8 位（含字母数字），返回明文仅展示一次 */
  async resetPassword(id: bigint) {
    const user = await this.assertExists(id)
    if (user.username === ADMIN_USERNAME) {
      throw new BusinessException(ErrorCode.AdminProtected, 'admin 用户不可重置密码')
    }
    const newPassword = this.generatePassword()
    const passwordHash = await bcrypt.hash(newPassword, 10)
    await this.prisma.sysUser.update({ where: { id }, data: { password: passwordHash } })
    return { password: newPassword }
  }

  /** 分配角色（admin 不可改角色）；全量覆盖并失效该用户 perms 缓存 */
  async assignRole(id: bigint, dto: AssignRoleDto) {
    const user = await this.assertExists(id)
    if (user.username === ADMIN_USERNAME) {
      throw new BusinessException(ErrorCode.AdminProtected, 'admin 用户不可修改角色')
    }
    await this.replaceUserRoles(id, dto.roleIds)
    await this.redis.client.del(RedisKey.userPerms(id.toString()))
    return { success: true }
  }

  /** 删除（软删除，admin 不可删除）；清理用户-角色关联；R10：仍有云盘文件者禁止删除 */
  async remove(id: bigint) {
    const user = await this.assertExists(id)
    if (user.username === ADMIN_USERNAME) {
      throw new BusinessException(ErrorCode.AdminProtected, 'admin 用户不可删除')
    }
    if (await this.cloud.hasFiles(id)) {
      throw new BusinessException(ErrorCode.CloudUserHasFiles, '该用户仍有云盘文件，禁止删除')
    }
    await this.prisma.sysUserRole.deleteMany({ where: { userId: id } })
    await this.prisma.sysUser.update({ where: { id }, data: { deletedAt: new Date() } })
    return { success: true }
  }

  /** 个人中心：修改自己的基本信息（昵称/邮箱/手机/性别，不含用户名/密码/角色/部门） */
  async updateProfile(id: bigint, dto: UpdateProfileDto) {
    await this.assertExists(id)
    await this.prisma.sysUser.update({ where: { id }, data: { ...dto } })
    return { success: true }
  }

  /** 按 id 查用户资料（含角色，剔除 password；供 AI 工具 get_my_profile 等复用） */
  async findById(id: bigint) {
    const user = await this.prisma.sysUser.findUnique({
      where: { id },
      include: { userRoles: { include: { role: { select: { id: true, name: true, code: true } } } } },
    })
    if (!user || user.deletedAt) throw new BusinessException(ErrorCode.NotFound, '用户不存在')
    const { password: _p, userRoles, ...rest } = user
    return { ...rest, roles: userRoles.map((ur) => ur.role) }
  }

  /** 按 username 精确查用户（供 AI 工具 kick_user 等复用） */
  async findByUsername(username: string) {
    return this.prisma.sysUser.findFirst({ where: { username, deletedAt: null } })
  }

  /** 个人中心：修改密码。校验旧密码后更新，并使该用户全部旧会话失效（PRD：改密后强制重新登录） */
  async changePassword(user: AuthUser, dto: ChangePasswordDto) {
    const dbUser = await this.assertExists(BigInt(user.userId))
    if (!(await bcrypt.compare(dto.oldPassword, dbUser.password))) {
      throw new BusinessException(ErrorCode.OldPasswordIncorrect, '旧密码错误')
    }
    const passwordHash = await bcrypt.hash(dto.newPassword, 10)
    await this.prisma.sysUser.update({ where: { id: dbUser.id }, data: { password: passwordHash } })

    // 记录密码修改时间（TTL=access 有效期，过期后旧 token 已自然失效），
    // JwtAuthGuard 据此拒绝所有早于该时间签发的 access token
    const accessTtl = parseDurationToSeconds(this.config.get<string>('jwt.accessExpires', '2h'))
    await this.redis.client.set(
      RedisKey.pwdChanged(user.userId),
      String(Math.floor(Date.now() / 1000)),
      'EX',
      accessTtl,
    )
    // 删除该用户全部 refresh token（多端登录一并失效）+ 清权限缓存
    await this.deleteAllRefreshTokens(dbUser.id)
    await this.redis.client.del(RedisKey.userPerms(dbUser.id.toString()))
    return { success: true }
  }

  /** SCAN 删除该用户的全部 refresh token（改密码强制全端下线） */
  private async deleteAllRefreshTokens(userId: bigint) {
    await this.redis.scanDel(`refresh:${userId}:*`)
  }

  /** 覆盖式写入用户-角色关联 */
  private async replaceUserRoles(userId: bigint, roleIds: number[]) {
    const uniqueRoleIds = [...new Set(roleIds)].map((rid) => BigInt(rid))
    await this.prisma.$transaction(async (tx) => {
      await tx.sysUserRole.deleteMany({ where: { userId } })
      if (uniqueRoleIds.length > 0) {
        await tx.sysUserRole.createMany({
          data: uniqueRoleIds.map((roleId) => ({ userId, roleId })),
        })
      }
    })
  }

  /** 生成随机 8 位密码（含字母数字，满足密码策略） */
  private generatePassword(): string {
    const letters = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ'
    const digits = '23456789'
    const all = letters + digits
    // 保证至少 1 字母 + 1 数字
    let pwd = letters[randomInt(letters.length)] + digits[randomInt(digits.length)]
    for (let i = 0; i < 6; i++) pwd += all[randomInt(all.length)]
    return pwd
      .split('')
      .sort(() => randomInt(3) - 1)
      .join('')
  }

  private async assertExists(id: bigint) {
    const user = await this.prisma.sysUser.findFirst({ where: { id, deletedAt: null } })
    if (!user) throw new BusinessException(ErrorCode.NotFound, '用户不存在')
    return user
  }

  private async assertDeptExists(deptId: bigint) {
    const dept = await this.prisma.sysDept.findFirst({ where: { id: deptId, deletedAt: null } })
    if (!dept) throw new BusinessException(ErrorCode.NotFound, '部门不存在')
  }
}
