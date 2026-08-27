import { Controller, Get, Headers, Param, Res } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import type { Response } from 'express'
import { Public } from '../../../gateway/decorators/public.decorator'
import { SkipTransform } from '../../../gateway/decorators/skip-transform.decorator'
import { ShareService } from './share.service'

/**
 * 公开链接访客侧（@Public 免登录，独立限流 30 次/分/IP）。
 * 校验链任一失败统一 30008，不区分原因（防探测）。
 */
@ApiTags('云盘-分享访客')
@Controller('cloud/share')
export class SharePublicController {
  constructor(private readonly shareService: ShareService) {}

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(':token')
  @ApiOperation({ summary: '链接信息（免登录）' })
  info(@Param('token') token: string) {
    return this.shareService.publicInfo(token)
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @SkipTransform()
  @Get(':token/download')
  @ApiOperation({ summary: '访客下载（免登录，成功 visit_count+1，支持 Range）' })
  async download(
    @Param('token') token: string,
    @Headers('range') range: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    await this.shareService.publicDownload(token, range ?? null, res)
  }
}
