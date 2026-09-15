import { registerAs } from '@nestjs/config'

/** 工具轮次上限读取（默认 3；上限 10 防失控——越界/非法一律回退默认值，P5 D65） */
export const AI_MAX_TOOL_ROUNDS_LIMIT = 10
export const AI_MAX_TOOL_ROUNDS_DEFAULT = 3

function readMaxToolRounds(): number {
  const value = Number(process.env.AI_MAX_TOOL_ROUNDS)
  if (!Number.isFinite(value) || value <= 0) return AI_MAX_TOOL_ROUNDS_DEFAULT
  return Math.min(Math.floor(value), AI_MAX_TOOL_ROUNDS_LIMIT)
}

/**
 * ai 域配置（P5 T75）：此前 AI 运行参数全部落在 DB（模型/厂商/套餐），
 * 唯一需要运维调的引擎阈值（工具轮次上限）本期配置化——照 upload/site 配置组风格。
 */
export default registerAs('ai', () => ({
  /** 单轮用户消息的工具调用轮次上限（env AI_MAX_TOOL_ROUNDS，默认 3，上限 10，D65） */
  maxToolRounds: readMaxToolRounds(),
}))
