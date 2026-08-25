import type { AuthUser } from '../../../gateway/guards/jwt.strategy'

/**
 * 工具调用上下文：handler 执行时传入，可拿到当前登录用户。
 * handler 内禁止直接操作其他域的表，只允许通过注入的域 Service 交互（见 ARCHITECTURE §12.3）。
 */
export interface ToolContext {
  user: AuthUser
}

/**
 * AI 工具定义（见 ARCHITECTURE §12.1）。
 * 每个工具 = tools/ 下一个文件 export 一个符合本接口的对象，并在 tool.registry 注册。
 */
export interface AiTool {
  /** 工具名，蛇形命名，如 get_online_users（模型据此选择工具） */
  name: string
  /** 给模型看的中文功能描述（决定模型能否选对工具的关键） */
  description: string
  /** JSON Schema（OpenAI tools 的 function.parameters 格式） */
  parameters: Record<string, unknown>
  /** 绑定权限标识；缺省 = 登录即可 */
  perms?: string
  /** read 自动执行 / write 需用户确认 */
  risk: 'read' | 'write'
  /** 执行逻辑，返回值会被序列化后回喂模型 */
  handler: (ctx: ToolContext, params: Record<string, unknown>) => Promise<unknown>
}

/** 工具风险级别 */
export type ToolRisk = 'read' | 'write'

/** ai_tool_call.status 取值 */
export type ToolCallStatus = 'pending' | 'confirmed' | 'rejected' | 'executed' | 'failed'
