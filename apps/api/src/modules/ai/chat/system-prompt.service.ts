import { Injectable, Logger, type OnModuleInit } from '@nestjs/common'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AuthUser } from '../../../gateway/guards/jwt.strategy'
import { PermissionService } from '../../../gateway/services/permission.service'
import { UserService } from '../../system/user/user.service'
import {
  CAPABILITY_MANIFEST,
  pickCapabilityRows,
  renderCapabilityList,
  type CapabilityRow,
} from './capability.manifest'
import { ASSISTANT_IDENTITY_NO_TOOLS, composeSystemPrompt, textLength } from './prompt.sections'

/**
 * System Prompt 服务（T23；P6 T77 改两段式 / D67 / R69，ARCHITECTURE §21.1）。
 *
 * 职责：
 * 1. 启动时把 `docs/PLATFORM-GUIDE.md`（**通用版段**）读入内存缓存（文件变更重启生效）；
 * 2. 每次对话按 `build(user)` 拼装：助手设定（静态）+ 通用版（静态）+ 能力清单（按权限动态）
 *    + 用户上下文；总长仍受 ≤2000 字硬约束（分段阈值见 scripts/check-ai-prompt.ts）。
 */
@Injectable()
export class SystemPromptService implements OnModuleInit {
  private readonly logger = new Logger(SystemPromptService.name)

  constructor(
    private readonly userService: UserService,
    private readonly permissionService: PermissionService,
  ) {}

  /** 通用版手册全文缓存 */
  private guide = ''

  onModuleInit(): void {
    this.guide = this.loadGuide()
    const capabilityChars = textLength(renderCapabilityList(CAPABILITY_MANIFEST))
    this.logger.log(
      `已加载平台手册通用版（${textLength(this.guide)} 字符）+ 能力清单常量（${CAPABILITY_MANIFEST.length} 行 / ` +
        `全量 ${capabilityChars} 字符，按权限动态注入）`,
    )
  }

  /** 通用版手册原文（核查脚本/排查用，只读） */
  get guideText(): string {
    return this.guide
  }

  /**
   * 拼装完整 system prompt（顺序固定：助手设定 → 通用版 → 能力清单 → 用户上下文）。
   *
   * P20 T170 / R161（能力同源）：`toolNames` = 本轮**实际下发**的工具名集合。提供时能力清单
   * 按该集合收窄——AI 的自我认知（prompt 承诺）与实际能力（tools）永远同源，不再出现
   * 「清单说能做、tools 里没有」的错位。集合为**空**（模型不支持工具 / 过滤后为空）时：
   * 能力清单**不注入**，且助手设定换成「无工具」版本（`ASSISTANT_IDENTITY_NO_TOOLS`）。
   */
  async build(user: AuthUser, toolNames?: ReadonlySet<string>): Promise<string> {
    const noTools = toolNames !== undefined && toolNames.size === 0
    const [rows, context] = await Promise.all([
      toolNames === undefined
        ? this.capabilitiesFor(user)
        : pickCapabilityRows(
            (perms) => this.permissionService.hasPermission(user.userId, perms),
            toolNames,
          ),
      this.buildUserContext(user),
    ])
    const capabilityList = noTools ? '' : renderCapabilityList(rows)
    const prompt = composeSystemPrompt({
      guide: this.guide,
      capabilityList,
      userContext: context,
      ...(noTools ? { identity: ASSISTANT_IDENTITY_NO_TOOLS } : {}),
    })
    this.logger.debug(
      `system prompt 分段：通用版=${textLength(this.guide)} 能力清单=${textLength(capabilityList)}` +
        `（${rows.length}/${CAPABILITY_MANIFEST.length} 项${noTools ? '，无工具已跳过' : ''}）` +
        `总长=${textLength(prompt)}`,
    )
    return prompt
  }

  /** 当前用户可见的能力行（按权限过滤，供核查/排查复用） */
  async capabilitiesFor(user: AuthUser): Promise<CapabilityRow[]> {
    return pickCapabilityRows((perms) => this.permissionService.hasPermission(user.userId, perms))
  }

  /** 用户上下文：昵称、角色名列表、当前日期 */
  private async buildUserContext(user: AuthUser): Promise<string> {
    let nickname = user.username
    let roleNames: string[] = []
    try {
      const profile = await this.userService.findById(BigInt(user.userId))
      nickname = profile.nickname || user.username
      roleNames = profile.roles.map((r: { name: string }) => r.name)
    } catch {
      // 查询失败时降级，不阻断对话
    }
    const today = new Date().toISOString().slice(0, 10)
    const roleText = roleNames.length > 0 ? roleNames.join('、') : '普通用户'
    return `当前用户信息：昵称「${nickname}」，角色：${roleText}，当前日期：${today}。`
  }

  /** 读通用版手册：优先项目根 docs/PLATFORM-GUIDE.md，失败降级为空（不阻断启动） */
  private loadGuide(): string {
    const candidates = [
      join(process.cwd(), '../../docs/PLATFORM-GUIDE.md'),
      join(process.cwd(), 'docs/PLATFORM-GUIDE.md'),
      join(process.cwd(), 'PLATFORM-GUIDE.md'),
    ]
    for (const p of candidates) {
      try {
        return readFileSync(p, 'utf-8')
      } catch {
        // 尝试下一个路径
      }
    }
    this.logger.warn('未找到 docs/PLATFORM-GUIDE.md，system prompt 将不含通用版手册内容')
    return ''
  }
}
