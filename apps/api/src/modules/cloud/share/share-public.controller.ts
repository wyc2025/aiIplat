import { Body, Controller, Get, Headers, Param, Post, Query, Req, Res } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import type { Request, Response } from 'express'
import { Public } from '../../../gateway/decorators/public.decorator'
import { SkipTransform } from '../../../gateway/decorators/skip-transform.decorator'
import { ShareVerifyDto } from './dto/share.dto'
import { ShareService } from './share.service'

/** 访客侧携带短期访问凭证的请求头（R42：提取码通过后签发） */
const SID_HEADER = 'x-share-sid'

/**
 * 分享链接访客侧（@Public 免登录，独立限流 30 次/分/IP）。
 * 校验链任一失败统一 30008（防探测）；有提取码且未持有效凭证 → 30017；提取码错误 → 30018。
 * P4d 升级（D46/D47/D48）：提取码校验、文件预览流（raw）、文件夹分享列表（动态子树 R43）与整包下载。
 *
 * 凭证传递：普通调用用请求头 `X-Share-Sid`；媒体类原生子资源（<video>/<img>/<iframe>/<a download>）
 * 无法自定义请求头，故同时接受 `?sid=` 查询参数作为等价通道（P4d 实现补充，T58 文档备案）。
 */
@ApiTags('云盘-分享访客')
@Controller('cloud/share')
export class SharePublicController {
  constructor(private readonly shareService: ShareService) {}

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post(':token/verify')
  @ApiOperation({ summary: '提取码校验（免登录；通过签发短期凭证 sid，无密码分享直通）' })
  verify(@Param('token') token: string, @Body() dto: ShareVerifyDto, @Req() req: Request) {
    return this.shareService.verify(token, dto, this.extractIp(req))
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(':token')
  @ApiOperation({ summary: '链接信息（免登录；含 needPassword/itemType/mime/ext；path 可选=文件夹内子项）' })
  info(
    @Param('token') token: string,
    @Headers(SID_HEADER) sid: string | undefined,
    @Query('sid') querySid: string | undefined,
    @Query('path') path: string | undefined,
  ) {
    return this.shareService.publicInfo(token, this.pickSid(sid, querySid), path)
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @SkipTransform()
  @Get(':token/raw')
  @ApiOperation({ summary: '文件预览流（免登录，inline + Range；MIME 口径 R44 同 R26）' })
  async raw(
    @Param('token') token: string,
    @Headers(SID_HEADER) sid: string | undefined,
    @Query('sid') querySid: string | undefined,
    @Query('path') path: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.shareService.publicFileStream(token, this.pickSid(sid, querySid), req, res, 'raw', path)
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(':token/list')
  @ApiOperation({ summary: '文件夹分享单层列表（免登录；动态子树 R43，阻断项不可见）' })
  list(
    @Param('token') token: string,
    @Headers(SID_HEADER) sid: string | undefined,
    @Query('sid') querySid: string | undefined,
    @Query('path') path: string | undefined,
  ) {
    return this.shareService.publicList(token, this.pickSid(sid, querySid), path)
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @SkipTransform()
  @Get(':token/download')
  @ApiOperation({ summary: '访客下载（免登录，成功 visit_count+1，支持 Range）' })
  async download(
    @Param('token') token: string,
    @Headers(SID_HEADER) sid: string | undefined,
    @Query('sid') querySid: string | undefined,
    @Query('path') path: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.shareService.publicFileStream(token, this.pickSid(sid, querySid), req, res, 'download', path)
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @SkipTransform()
  @Get(':token/pack')
  @ApiOperation({ summary: '文件夹分享整包下载（免登录，流式 zip，访客视角含三态过滤）' })
  async pack(
    @Param('token') token: string,
    @Headers(SID_HEADER) sid: string | undefined,
    @Query('sid') querySid: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    await this.shareService.publicPack(token, this.pickSid(sid, querySid), res)
  }

  /** 凭证取值：请求头优先，其次查询参数（原生子资源通道） */
  private pickSid(headerSid?: string, querySid?: string): string | null {
    return headerSid ?? querySid ?? null
  }

  /** IP 取值：X-Forwarded-For 首段，无该头取 socket 地址（R8 口径，与开放层/pub 一致） */
  private extractIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for']
    if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim()
    return req.ip ?? ''
  }
}
