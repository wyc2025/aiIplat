import { Controller, Get, Param, Query, Req, Res } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Request, Response } from 'express'
import { ErrorCode } from '../../../common/constants/error-code'
import { RedisKey } from '../../../common/constants/redis-key'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { Public } from '../../../gateway/decorators/public.decorator'
import { SkipTransform } from '../../../gateway/decorators/skip-transform.decorator'
import { RedisService } from '../../../infra/redis/redis.service'
import type { CloudFile } from '@prisma/client'
import { PubService } from './pub.service'

/** 限流窗口（秒）：独立限流桶（R32，照 P4a 开放层口径） */
const RATE_WINDOW_SEC = 60
/** 数据类端点（info/list）限流：60 次/分/IP */
const DATA_RATE_LIMIT = 60
/** 静态类端点（raw/download）限流：120 次/分/IP */
const STATIC_RATE_LIMIT = 120

/**
 * 云盘公开访问端点（P4c D31）：独立前缀 /api/pub/，与站点开放层 /api/open/ 并列，共享开放层纪律：
 * @Public 免登录、独立限流桶、资源类错误统一 40400 防探测、禁挂 @OperationLog。
 * f/{token} 三件套 + d/{token} 四件套（契约见 API-P4C-增补 §8.3）。
 */
@ApiTags('云盘-公开访问')
@Controller('pub')
export class PubController {
  constructor(
    private readonly pubService: PubService,
    private readonly redis: RedisService,
  ) {}

  // ---------- 文件三件套 ----------

  @Public()
  @Get('f/:token/info')
  @ApiOperation({ summary: '公开文件元信息（免登录，数据限流 60/分/IP）' })
  async fileInfo(@Param('token') token: string, @Req() req: Request) {
    await this.assertDataRate(req)
    const row = await this.pubService.resolvePublicFile(token)
    return this.pubService.toInfo(row)
  }

  @Public()
  @SkipTransform()
  @Get('f/:token/raw')
  @ApiOperation({ summary: '公开文件流（inline + Range + ETag/304，静态限流 120/分/IP）' })
  async rawFile(@Param('token') token: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    await this.assertStaticRate(req)
    const row = await this.pubService.resolvePublicFile(token)
    await this.pubService.serveFile(row, req, res, 'raw')
  }

  @Public()
  @SkipTransform()
  @Get('f/:token/download')
  @ApiOperation({ summary: '公开文件下载（attachment + 原名，静态限流 120/分/IP）' })
  async downloadFile(@Param('token') token: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    await this.assertStaticRate(req)
    const row = await this.pubService.resolvePublicFile(token)
    await this.pubService.serveFile(row, req, res, 'download')
  }

  // ---------- 文件夹四件套 ----------

  @Public()
  @Get('d/:token/list')
  @ApiOperation({ summary: '公开文件夹单层列表（allow_listing=0 → 40117；数据限流 60/分/IP）' })
  async listFolder(
    @Param('token') token: string,
    @Query('path') path: string | undefined,
    @Req() req: Request,
  ) {
    await this.assertDataRate(req)
    const folder = await this.pubService.resolvePublicFolder(token)
    return this.pubService.listFolder(folder, path)
  }

  @Public()
  @Get('d/:token/info')
  @ApiOperation({ summary: '公开文件夹内子项元信息（path 指向文件；数据限流 60/分/IP）' })
  async subFileInfo(
    @Param('token') token: string,
    @Query('path') path: string | undefined,
    @Req() req: Request,
  ) {
    await this.assertDataRate(req)
    const row = await this.resolveSub(token, path)
    return this.pubService.toInfo(row)
  }

  @Public()
  @SkipTransform()
  @Get('d/:token/raw')
  @ApiOperation({ summary: '公开文件夹内子文件流（inline + Range；静态限流 120/分/IP）' })
  async rawSubFile(
    @Param('token') token: string,
    @Query('path') path: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.assertStaticRate(req)
    const row = await this.resolveSub(token, path)
    await this.pubService.serveFile(row, req, res, 'raw')
  }

  @Public()
  @SkipTransform()
  @Get('d/:token/download')
  @ApiOperation({ summary: '公开文件夹内子文件下载（attachment；静态限流 120/分/IP）' })
  async downloadSubFile(
    @Param('token') token: string,
    @Query('path') path: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.assertStaticRate(req)
    const row = await this.resolveSub(token, path)
    await this.pubService.serveFile(row, req, res, 'download')
  }

  // ---------- 内部 ----------

  /** 子项寻址（d 三件套共用）：token 文件夹 → path 下行到文件 */
  private async resolveSub(token: string, path: string | undefined): Promise<CloudFile> {
    const folder = await this.pubService.resolvePublicFolder(token)
    return this.pubService.resolveSubFile(folder, path)
  }

  /** 数据类限流（60 次/分/IP，超限 42900） */
  private async assertDataRate(req: Request): Promise<void> {
    await this.assertRate(req, 'data', DATA_RATE_LIMIT)
  }

  /** 静态类限流（120 次/分/IP，超限 42900） */
  private async assertStaticRate(req: Request): Promise<void> {
    await this.assertRate(req, 'static', STATIC_RATE_LIMIT)
  }

  /** 独立限流桶（R32）：Redis INCR + 首次 60s TTL；超限 42900（限流不属 40400 防探测例外） */
  private async assertRate(req: Request, bucket: 'data' | 'static', limit: number): Promise<void> {
    const ip = this.extractIp(req)
    const key = RedisKey.pubRate(bucket, ip)
    const count = await this.redis.client.incr(key)
    if (count === 1) {
      await this.redis.client.expire(key, RATE_WINDOW_SEC).catch(() => undefined)
    }
    if (count > limit) {
      throw new BusinessException(ErrorCode.TooManyRequests, '请求过于频繁')
    }
  }

  /** IP 取值：X-Forwarded-For 首段，无该头取 socket 地址（R8 口径，与开放层一致） */
  private extractIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for']
    if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim()
    return req.ip ?? ''
  }
}
