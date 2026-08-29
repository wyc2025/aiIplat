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
  /** 中文动作名（给人看，用于确认卡片标题 / 工具结果标签） */
  title: string
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
  /**
   * write 工具确认卡结构化摘要（P4b §15.6，可选）：返回值 JSON 序列化进确认单与
   * tool_confirm 事件，前端确认卡渲染为结构化清单；返回 null/undefined 或抛错时
   * 由 chat.service 回退 P2b 现状（params 截断字符串）。缺省 = 现状，既有工具零改动。
   * （实现注：相比 §15.6 草图 (params) => any 补充了 ctx 入参——summarize 需要按当前用户
   * 查数据，如 write_site_files 预判 action 需以 userId 查站点文件树，T42 已登记。）
   */
  summarize?: (params: Record<string, unknown>, ctx: ToolContext) => unknown
}

/** 工具风险级别 */
export type ToolRisk = 'read' | 'write'

/** ai_tool_call.status 取值 */
export type ToolCallStatus = 'pending' | 'confirmed' | 'rejected' | 'executed' | 'failed'
