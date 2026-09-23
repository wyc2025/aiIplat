import { Injectable } from '@nestjs/common'
import { AdminService } from '../admin/admin.service'
import { PageService } from '../page/page.service'
import { SchemaService } from '../schema/schema.service'
import type { FieldDefDto } from '../schema/dto/schema.dto'

/** AI 工具建表入参（工具契约 API-P11 §4 的域内投影） */
export interface AppTableDefInput {
  table: string
  label: string
  fields: FieldDefDto[]
}

/**
 * app 域门面（P11，D96/铁律 3/6）：AI 工具与其它域经本门面调用 app 域能力，
 * 禁止绕过门面直连 app 的 Service/表。
 *
 * 拓扑（防环）：
 * - ai 域（工具 handler）→ AppFacade（createAppDraft / addTable / addFields / setRelation / …）
 * - cloud 域（删除预检）→ AppRefService（app-ref.module，最小模块，防环）
 * - app 域（附件上传）→ CloudFacade.uploadForApp
 *
 * 本类只依赖 app 域导出的 Service（AdminService / SchemaService / PageService / DataService），
 * 不 import 其它业务模块的内部实现。T101 落应用创建/确认，T102 落结构管理，T103/T104 续接。
 */
@Injectable()
export class AppFacade {
  constructor(
    private readonly adminService: AdminService,
    private readonly schemaService: SchemaService,
    private readonly pageService: PageService,
  ) {}

  /** AI 创建应用草稿（工具 create_data_app；draft 不占 active 额度，限 3 个） */
  async createAppDraft(
    userId: bigint,
    name: string,
    description?: string,
  ): Promise<{ ok: true; appCode: string; status: string }> {
    const result = await this.adminService.create(userId, {
      name,
      description,
      mode: 'draft',
    })
    return { ok: true, appCode: result.appCode, status: result.status }
  }

  /** AI 确认应用入册（工具 confirm_data_app；draft → active，查配额） */
  async confirmDataApp(
    userId: bigint,
    appCode: string,
  ): Promise<{ ok: true; status: string; menuHint: string }> {
    const result = await this.adminService.confirm(userId, appCode)
    return { ok: true, status: result.status, menuHint: result.menuHint }
  }

  /** AI 建表（工具 add_table；含初始字段，refTable 自动建 1n 关联字段） */
  async addTable(
    userId: bigint,
    appCode: string,
    input: AppTableDefInput,
  ): Promise<{ ok: true; table: string; created: string[] }> {
    const result = await this.schemaService.createTable(userId, appCode, {
      name: input.table,
      label: input.label,
      fields: input.fields,
    })
    return { ok: true, table: result.table, created: result.created }
  }

  /** AI 加字段（工具 add_fields） */
  async addFields(
    userId: bigint,
    appCode: string,
    table: string,
    fields: FieldDefDto[],
  ): Promise<{ ok: true; table: string; created: string[] }> {
    const resolved = await this.schemaService.resolveTableByName(
      (await this.adminService.assertOwned(userId, appCode)).id,
      table,
    )
    const created: string[] = []
    for (const field of fields) {
      const result = await this.schemaService.addField(userId, appCode, resolved.id, field)
      created.push(result.field)
    }
    return { ok: true, table, created }
  }

  /** AI 建 n:n 关系（工具 set_relation；幂等） */
  async setRelation(
    userId: bigint,
    appCode: string,
    fromTable: string,
    fromField: string,
    toTable: string,
  ): Promise<{ ok: true; relation: string; throughTable: string }> {
    const result = await this.schemaService.createRelation(userId, appCode, {
      fromTable,
      fromField,
      toTable,
    })
    return { ok: true, relation: result.relation, throughTable: result.throughTable }
  }

  /** AI 生成管理页（工具 gen_admin_page；按 purpose 选主表，生成三区块标准页） */
  async genAdminPage(
    userId: bigint,
    appCode: string,
    name: string,
    purpose: string,
  ): Promise<{ ok: true; pageCode: string; route: string; blocks: number }> {
    const result = await this.pageService.genAdminPage(userId, appCode, name, purpose)
    return { ok: true, pageCode: result.pageCode, route: result.route, blocks: result.blocks }
  }

  /** AI 调整功能页（工具 adjust_page；本期为按当前表结构刷新区块） */
  async adjustPage(
    userId: bigint,
    appCode: string,
    pageCode: string,
    instruction: string,
  ): Promise<{ ok: true; changed: string }> {
    const result = await this.pageService.adjustPage(userId, appCode, pageCode, instruction)
    return { ok: true, changed: result.changed }
  }

  /** R96：userinfo 菜单动态段（active 应用 ▸ 功能页），供 auth 域拼装菜单树 */
  async getAppMenuSegments(
    userId: bigint,
  ): Promise<
    Array<{ appCode: string; name: string; pages: Array<{ code: string; name: string }> }>
  > {
    return this.adminService.getAppMenuSegments(userId)
  }
}
