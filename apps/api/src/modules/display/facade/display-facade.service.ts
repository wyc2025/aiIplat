import { Injectable } from '@nestjs/common'
import { DisplayService, type AccessPrincipal, type DisplayView } from '../manage/display.service'

/**
 * display 域门面（P14 T125 / ARCH §30.1）：跨域唯一入口（铁律 3/6）。
 *
 * 消费方：
 * - **site 域开放层**：静态文件服务与数据端点 R125 校验链调 `assertCanRead` / `resolveForOpen`；
 * - **ai 域工具**（T130）：`create_display_app` / `authorize_data_app` 经本门面落库；
 * - **market 域**（T129）：bundle 物化用 `materializeBundle`（经 AppFacade 编排回本门面）。
 *
 * site 域与 app 域均不得直读 `disp_display` / `disp_grant`（无物理 FK，跨域禁 JOIN）。
 */
@Injectable()
export class DisplayFacade {
  constructor(private readonly displayService: DisplayService) {}

  /** 我的展示应用列表（后管与工具摘要用；含挂靠站点与授权清单） */
  async listDisplays(userId: bigint): Promise<DisplayView[]> {
    return this.displayService.list(userId)
  }

  /** 创建展示应用（D112；siteSlug 缺省 → 云盘暂存区；重名 50018） */
  async createDisplay(
    userId: bigint,
    input: { name: string; siteSlug?: string },
  ): Promise<DisplayView> {
    return this.displayService.create(userId, input)
  }

  /** 挂靠 / 换挂靠 / 取消挂靠（D116/R127：目录移动与挂靠关系同事务语义） */
  async affiliateDisplay(
    userId: bigint,
    displayId: bigint,
    siteSlug?: string | null,
  ): Promise<DisplayView & { moved: boolean }> {
    return this.displayService.affiliate(userId, displayId, siteSlug)
  }

  /** 软删展示应用（清授权边，目录保留云盘） */
  async removeDisplay(userId: bigint, displayId: bigint): Promise<{ ok: true; id: string }> {
    return this.displayService.remove(userId, displayId)
  }

  /** 授权：数据应用 → 展示应用（重复 50017；返回 appName/isPublic 供 UI 提示未发布） */
  async grantDataApp(userId: bigint, displayId: bigint, appCode: string) {
    return this.displayService.grant(userId, displayId, appCode)
  }

  /** 撤权 */
  async revokeDataApp(userId: bigint, displayId: bigint, appCode: string) {
    return this.displayService.revoke(userId, displayId, appCode)
  }

  /**
   * R125 修订版第 ③ 步（P15 R138 主体化）：该**展示应用**是否被授予此数据应用（未命中 40400）。
   * 挂靠校验（存在 / 未软删 / 本站点）由 `resolveForOpen` 前置完成（D123 粒度收窄到展示应用级）。
   */
  async assertCanRead(appId: bigint, principal: AccessPrincipal): Promise<void> {
    return this.displayService.assertCanRead(appId, principal)
  }

  /**
   * 挂靠指定站点的展示应用工作区清单（P20 B2：站点发布时聚合为 `快照/disp/{id}/`）。
   *
   * 只回「挂靠本站点 + 未软删」的项；工作区路径**恒定位**（B1），故发布侧无需了解站点树结构。
   * 返回空数组表示该站点当前没有可发布的展示应用（合法状态，不是错误）。
   */
  async listWorkPathsBySite(
    siteId: bigint,
    ownerId: bigint,
  ): Promise<Array<{ displayId: string; workPath: string }>> {
    return this.displayService.listWorkPathsBySite(siteId, ownerId)
  }

  /**
   * 取某个展示应用的工作区定位信息（P20 T168：站点「只发布这一个展示页」时用）。
   *
   * 返回 `null` 表示该应用未挂靠本站点或已不可用 —— 局部发布此时**摘掉它的子树**即止，
   * 不报错（调用方语义是「把线上该应用的内容换成它现在的样子」，已删除的应用自然为空）。
   */
  async resolveForRelease(
    siteId: bigint,
    displayId: bigint,
  ): Promise<{ ownerId: bigint; workPath: string } | null> {
    return this.displayService.resolveForRelease(siteId, displayId)
  }

  /** 开放层静态服务解析（`:slug/disp/:id/**`）：返回站点内相对路径（未挂靠/挂他站 → 40400） */
  async resolveForOpen(
    siteId: bigint,
    displayId: bigint,
  ): Promise<{ displayId: string; relPath: string; ownerId: string }> {
    return this.displayService.resolveForOpen(siteId, displayId)
  }

  /** 市场 bundle 导出（T129/D117）：数据应用的出边授权闭包（展示应用 + 文本文件） */
  async exportBundle(ownerId: bigint, appId: bigint) {
    return this.displayService.exportBundle(ownerId, appId)
  }

  /** 市场 bundle 物化（T129/D117）：接收方建展示应用副本（未挂靠暂存区）并重建授权边 */
  async materializeBundle(
    userId: bigint,
    newAppId: bigint,
    input: {
      displays: Array<{ name: string; files: Array<{ path: string; content: string }> }>
      grants: Array<{ displayName: string }>
    },
  ) {
    return this.displayService.materializeBundle(userId, newAppId, input)
  }
}
