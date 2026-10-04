import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Req, Res } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger'
import type { Request, Response } from 'express'
import { CurrentUser } from '../../../gateway/decorators/current-user.decorator'
import { OperationLog } from '../../../gateway/decorators/operation-log.decorator'
import { RequirePermission } from '../../../gateway/decorators/require-permission.decorator'
import { PinReleaseDto, PublishSiteDto } from './dto/release.dto'
import { SitePreviewService } from './site-preview.service'
import { SiteReleaseService } from './site-release.service'

/**
 * 站点发布与版本管理（P19 T161；API-P19 §1 端点 1~6）。
 *
 * 与站点 CRUD 同命名空间 `/api/site/manage/*`、同鉴权（`site:site:manage`）——
 * 路由段数多于 `:id` 故与既有端点无歧义（API-P19 头部约定）。
 *
 * 语义要点：**发布即上线**（快照 + 指针翻转，D143）；**回滚 = activate 旧版**（毫秒级，可反复横跳）；
 * 当前版本与锁定版本不可删（R158）；预览读工作副本、仅管理态可达（D149，开放层不设预览入口）。
 */
@ApiTags('个人网站-发布与版本')
@ApiBearerAuth()
@Controller('site/manage')
export class SiteReleaseController {
  constructor(
    private readonly releases: SiteReleaseService,
    private readonly preview: SitePreviewService,
  ) {}

  @Post(':id/publish')
  @RequirePermission('site:site:manage')
  @OperationLog('个人网站', '发布站点版本')
  @ApiParam({ name: 'id', description: '站点 ID' })
  @ApiOperation({ summary: '发布当前工作副本为新版本并置为当前（发布即上线；并发发布 40121）' })
  publish(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PublishSiteDto,
  ) {
    return this.releases.publish(BigInt(userId), BigInt(id), dto.label)
  }

  @Get(':id/releases')
  @RequirePermission('site:site:manage')
  @ApiParam({ name: 'id', description: '站点 ID' })
  @ApiOperation({ summary: '版本列表（倒序；量小不分页）' })
  list(@CurrentUser('userId') userId: string, @Param('id', ParseIntPipe) id: number) {
    return this.releases.list(BigInt(userId), BigInt(id))
  }

  @Post(':id/releases/:rid/activate')
  @RequirePermission('site:site:manage')
  @OperationLog('个人网站', '切换站点版本')
  @ApiParam({ name: 'id', description: '站点 ID' })
  @ApiParam({ name: 'rid', description: '版本 ID' })
  @ApiOperation({ summary: '切换当前版本（回滚 = 切旧版；即时生效，可反复横跳）' })
  activate(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseIntPipe) id: number,
    @Param('rid', ParseIntPipe) rid: number,
  ) {
    return this.releases.activate(BigInt(userId), BigInt(id), BigInt(rid))
  }

  @Post(':id/releases/:rid/pin')
  @RequirePermission('site:site:manage')
  @OperationLog('个人网站', '锁定站点版本')
  @ApiParam({ name: 'id', description: '站点 ID' })
  @ApiParam({ name: 'rid', description: '版本 ID' })
  @ApiOperation({ summary: '锁定 / 解锁版本（锁定版豁免自动清理与手动删除）' })
  pin(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseIntPipe) id: number,
    @Param('rid', ParseIntPipe) rid: number,
    @Body() dto: PinReleaseDto,
  ) {
    return this.releases.pin(BigInt(userId), BigInt(id), BigInt(rid), dto.pinned)
  }

  @Delete(':id/releases/:rid')
  @RequirePermission('site:site:manage')
  @OperationLog('个人网站', '删除站点版本')
  @ApiParam({ name: 'id', description: '站点 ID' })
  @ApiParam({ name: 'rid', description: '版本 ID' })
  @ApiOperation({ summary: '删除版本（当前版本 / 锁定版拒绝 40001；同时清理快照目录）' })
  remove(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseIntPipe) id: number,
    @Param('rid', ParseIntPipe) rid: number,
  ) {
    return this.releases.remove(BigInt(userId), BigInt(id), BigInt(rid))
  }

  /**
   * 预览工作副本（D149/FR6）：登录 + 站点权限，读**工作副本**出流——编辑器/AI 迭代即见，
   * 与线上版本无关。开放层**不设**预览入口（避免出现第二个公开面）。
   *
   * 安全件与开放层同款（MIME 白名单 + CSP 沙箱 + nosniff + ETag/304 + no-cache），
   * 未登录由全局 JwtAuthGuard 拦为 401，无权限由 RequirePermission 拦为 403。
   */
  @Get(':id/preview/*path')
  @RequirePermission('site:site:manage')
  @ApiParam({ name: 'id', description: '站点 ID' })
  @ApiOperation({ summary: '预览工作副本（管理态专用；安全件与开放层同款）' })
  async servePreview(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const raw = (req.params as Record<string, unknown>).path
    const path = Array.isArray(raw) ? raw.join('/') : String(raw ?? '')
    await this.preview.serve(BigInt(userId), BigInt(id), path, req, res)
  }
}
