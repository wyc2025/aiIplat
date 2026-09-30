import type { AppFacade } from '../../../app/facade/app-facade.service'
import type { AiTool } from '../tool.types'
import { feedAppError, readStr } from './app-error.util'

/** 暴露目标两档（P14 T126：`page` 档随 display 展示页废弃退役） */
const TARGETS = ['table', 'field'] as const
type ExposeTarget = (typeof TARGETS)[number]

/**
 * 粒度暴露开关（write，P13 T120 / R110 / D110；P14 T126 收缩为两档）。
 *
 * target=table 传表名；target=field 传「表.字段」（或应用内唯一字段名）。
 * 暴露范围决定**授权取数面**（展示应用挂靠的站点，经 `/api/open/:slug/api/app/:appCode/...`）
 * 能读到哪些数据：`is_public` 总开关（`publish_data_app`）为第一道闸，本工具管表·字段级（第三、四道）。
 */
export function createExposeDataAppTool(appFacade: AppFacade): AiTool {
  return {
    name: 'expose_data_app',
    title: '设置数据应用暴露范围',
    description:
      '按粒度开关数据应用的暴露项（决定授权给展示应用后，外部能读取哪些数据）：' +
      'target=table 时 name 传表名（表未暴露时该表下所有字段对外不可见）；' +
      'target=field 时 name 传「表名.字段名」（如同一字段名在多表出现则必须带表名前缀）。' +
      'isExposed=true 暴露、false 隐藏。本工具是 publish_data_app 的前置：缺项（missing）通常靠它逐项补齐。',
    parameters: {
      type: 'object',
      properties: {
        appCode: { type: 'string', description: '应用 code（list_data_apps 返回的 appCode）' },
        target: {
          type: 'string',
          enum: ['table', 'field'],
          description: '暴露对象类型：table=表 / field=字段',
        },
        name: {
          type: 'string',
          description: '对象名：表名 / 「表名.字段名」',
        },
        isExposed: { type: 'boolean', description: 'true = 暴露（可被授权读取）；false = 隐藏' },
      },
      required: ['appCode', 'target', 'name', 'isExposed'],
      additionalProperties: false,
    },
    risk: 'write',
    summarize: (params) => {
      const appCode = readStr(params, 'appCode')
      const target = readStr(params, 'target')
      const name = readStr(params, 'name')
      const label = target === 'table' ? '表' : '字段'
      const action = params.isExposed === true ? '暴露（可被授权读取）' : '隐藏'
      return `设置数据应用「${appCode}」的${label}「${name}」为${action}`
    },
    handler: async (ctx, params) => {
      const appCode = readStr(params, 'appCode')
      const target = readStr(params, 'target') as ExposeTarget
      const name = readStr(params, 'name')
      if (!appCode || !name) {
        return { ok: false, errorCode: 40001, message: 'appCode 与 name 必填' }
      }
      if (!(TARGETS as readonly string[]).includes(target)) {
        return {
          ok: false,
          errorCode: 40001,
          message: `target 仅允许 table / field，收到：${target || '(空)'}`,
        }
      }
      if (typeof params.isExposed !== 'boolean') {
        return { ok: false, errorCode: 40001, message: 'isExposed 必须是布尔值（true/false）' }
      }
      try {
        return await appFacade.setExposure(
          BigInt(ctx.user.userId),
          appCode,
          target,
          name,
          params.isExposed ? 1 : 0,
        )
      } catch (e) {
        return feedAppError(e)
      }
    },
  }
}
