import { Injectable, Logger, type OnModuleInit } from '@nestjs/common'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AuthUser } from '../../../gateway/guards/jwt.strategy'
import { UserService } from '../../system/user/user.service'

/** 助手设定（固定文案，见 ARCHITECTURE §12.4） */
const ASSISTANT_IDENTITY = '你是 iplat 平台内置 AI 助手，可使用提供的工具帮助用户查询信息、操作系统。'

/** 工具使用原则（固定文案） */
const TOOL_RULES = [
  '工具使用原则：',
  '- read 类工具可直接执行并返回结果；',
  '- write 类工具必须先向用户展示操作内容、经用户明确确认后才能执行；',
  '- 当用户的需求无法用现有工具完成时，引导用户到左侧菜单手动操作，禁止编造不存在的功能或结果。',
].join('\n')

/**
 * System Prompt 服务（T23）。
 * 职责：启动时把 docs/PLATFORM-GUIDE.md 全文读入内存缓存（文件变更重启生效），
 * 并拼装完整 system prompt（助手设定 + 手册 + 用户上下文 + 工具原则）。
 */
@Injectable()
export class SystemPromptService implements OnModuleInit {
  private readonly logger = new Logger(SystemPromptService.name)

  constructor(private readonly userService: UserService) {}

  /** 手册全文缓存 */
  private guide = ''

  onModuleInit(): void {
    this.guide = this.loadGuide()
    this.logger.log(`已加载平台手册（${this.guide.length} 字符）`)
  }

  /**
   * 拼装完整 system prompt（顺序固定：设定 → 手册 → 用户上下文 → 工具原则）。
   * 用户上下文含昵称、角色名、当前日期；不注入权限标识明细（权限由工具过滤兜底）。
   */
  async build(user: AuthUser): Promise<string> {
    const context = await this.buildUserContext(user)
    return [ASSISTANT_IDENTITY, this.guide, context, TOOL_RULES].filter(Boolean).join('\n\n')
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

  /** 读手册：优先项目根 docs/PLATFORM-GUIDE.md，失败降级为空（不阻断启动） */
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
    this.logger.warn('未找到 docs/PLATFORM-GUIDE.md，system prompt 将不含手册内容')
    return ''
  }
}
