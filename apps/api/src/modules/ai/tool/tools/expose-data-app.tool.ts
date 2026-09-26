import type { AppFacade } from '../../../app/facade/app-facade.service'
import type { AiTool } from '../tool.types'
import { feedAppError, readStr } from './app-error.util'

/** 暴露目标三档（R110 / API §20.2） */
const TARGETS = ['table', 'field', 'page'] as const
type ExposeTarget = (typeof TARGETS)[number]

/**
 * 粒度暴露开关（write，P13 T120 / R110 / D110）。
 *
 * target=table 传表名；target=field 传「表.字段」（或应用内唯一字段名）；target=page 传页 code 或页名，
 * **仅展示页（display）可公开**（admin 页 50004，R110）。暴露范围决定公开接口/展示页能取到哪些数据。
 */
export function createExposeDataAppTool(appFacade: AppFacade): AiTool {
  return {
    name: 'expose_data_app',
    title: '设置数据应用暴露范围',
    description:
      '按粒度开关数据应用的公开暴露项（决定公开发布后外部能取到哪些数据）：' +
      'target=table 时 name 传表名（表未暴露时该表下所有字段对外不可见）；' +
      'target=field 时 name 传「表名.字段名」（如同一字段名在多表出现则必须带表名前缀）；' +
      'target=page 时 name 传功能页 code 或页名，且**只有展示页（display）可以公开**，管理页（admin）会返回 50004。' +
      'isExposed=true 暴露、false 隐藏。本工具是 publish_data_app 的前置：发布校验缺项（missing）通常靠它逐项补齐。',
    parameters: {
      type: 'object',
      properties: {
        appCode: { type: 'string', description: '应用 code（list_data_apps 返回的 appCode）' },
        target: {
          type: 'string',
          enum: ['table', 'field', 'page'],
          description: '暴露对象类型：table=表 / field=字段 / page=功能页（仅 display）',
        },
        name: {
          type: 'string',
          description: '对象名：表名 / 「表名.字段名」/ 页 code 或页名',
        },
        isExposed: { type: 'boolean', description: 'true = 暴露（公开可见）；false = 隐藏' },
      },
      required: ['appCode', 'target', 'name', 'isExposed'],
      additionalProperties: false,
    },
    risk: 'write',
    summarize: (params) => {
      const appCode = readStr(params, 'appCode')
      const target = readStr(params, 'target')
      const name = readStr(params, 'name')
      const label = target === 'table' ? '表' : target === 'field' ? '字段' : '展示页'
      const action = params.isExposed === true ? '暴露（公开可见）' : '隐藏'
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
          message: `target 仅允许 table / field / page，收到：${target || '(空)'}`,
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
