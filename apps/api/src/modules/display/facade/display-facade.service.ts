import { Injectable } from '@nestjs/common'
import { DisplayService, type DisplayView } from '../manage/display.service'

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

  /** R125 第 ② 步：站点下是否存在被授予该数据应用的挂靠展示应用（未命中 40400） */
  async assertCanRead(appId: bigint, siteId: bigint): Promise<void> {
    return this.displayService.assertCanRead(appId, siteId)
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
