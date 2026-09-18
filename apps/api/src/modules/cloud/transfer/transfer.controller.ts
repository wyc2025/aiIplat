import { Body, Controller, Get, Headers, Param, ParseIntPipe, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import type { Response } from 'express'
import { CurrentUser } from '../../../gateway/decorators/current-user.decorator'
import { OperationLog } from '../../../gateway/decorators/operation-log.decorator'
import { Public } from '../../../gateway/decorators/public.decorator'
import { RequirePermission } from '../../../gateway/decorators/require-permission.decorator'
import { SkipTransform } from '../../../gateway/decorators/skip-transform.decorator'
import { FileStreamQueryDto } from './dto/file-ticket.dto'
import { PackDownloadDto } from './dto/pack.dto'
import { UploadQueryDto } from './dto/transfer.dto'
import { PackService } from './pack.service'
import { CLOUD_UPLOAD_OPTIONS } from './tmp-storage'
import { TransferService } from './transfer.service'
import { UnzipService } from './unzip.service'

/** 上传 / 预览 / 下载 / 解压 / 打包下载（与 FileController 同前缀，路由不冲突） */
@ApiTags('云盘-文件传输')
@ApiBearerAuth()
@Controller('cloud/file')
export class TransferController {
  constructor(
    private readonly transferService: TransferService,
    private readonly unzipService: UnzipService,
    private readonly packService: PackService,
  ) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', CLOUD_UPLOAD_OPTIONS))
  @RequirePermission('cloud:file:upload')
  @OperationLog('云盘', '上传文件')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '上传文件（全程流式：tmp→正式区，配额校验，同名自动 (1)）' })
  upload(
    @CurrentUser('userId') userId: string,
    @Query() query: UploadQueryDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.transferService.upload(BigInt(userId), BigInt(query.parentId ?? 0), file, query.overwrite ?? 0)
  }

  /**
   * 打包下载（P4d T54/R41）：多选文件+文件夹混合 → yazl 流式 zip（零落盘 D45）。
   * @SkipTransform 流式；条目跳过记账进响应头 X-Pack-Skipped（不进操作日志，避免大包写库开销）。
   */
  @Post('pack-download')
  @SkipTransform()
  @RequirePermission('cloud:file:list')
  @ApiOperation({ summary: '批量打包下载（流式 zip，目录结构保留，UTF-8 条目名）' })
  async packDownload(
    @CurrentUser('userId') userId: string,
    @Body() dto: PackDownloadDto,
    @Res() res: Response,
  ): Promise<void> {
    await this.packService.packToResponse(BigInt(userId), dto.ids.map((id) => BigInt(id)), res)
  }

  @Post(':id/unzip')
  @RequirePermission('cloud:file:upload')
  @OperationLog('云盘', '在线解压')
  @ApiOperation({ summary: '在线解压（仅 zip → 同目录包名文件夹；同步执行，安全四件套 R29）' })
  unzip(@CurrentUser('userId') userId: string, @Param('id', ParseIntPipe) id: number) {
    return this.unzipService.unzip(BigInt(userId), BigInt(id))
  }

  @Get('preview/:id')
  @SkipTransform()
  @RequirePermission('cloud:file:list')
  @ApiOperation({ summary: '文件预览（白名单 inline，文本强制 text/plain，支持 Range）' })
  async preview(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseIntPipe) id: number,
    @Headers('range') range: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    await this.transferService.preview(BigInt(userId), BigInt(id), range ?? null, res)
  }

  @Get('download/:id')
  @SkipTransform()
  @RequirePermission('cloud:file:list')
  @ApiOperation({ summary: '文件下载（attachment 原文件名，支持 Range）' })
  async download(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseIntPipe) id: number,
    @Headers('range') range: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    await this.transferService.download(BigInt(userId), BigInt(id), range ?? null, res)
  }

  /**
   * 直链票据（P7 走查 W7）：登录态签发单文件短票据，前端把返回的 previewUrl/downloadUrl
   * 交给原生 `<video>/<img>/<iframe>` 与下载链接，从而吃到 Range（秒开 + 拖动进度 + 断点续传 + 零内存驻留）。
   */
  @Get('ticket/:id')
  @RequirePermission('cloud:file:list')
  @ApiOperation({ summary: '签发预览/下载直链票据（2h、单文件；HMAC，无状态）' })
  ticket(@CurrentUser('userId') userId: string, @Param('id', ParseIntPipe) id: number) {
    return this.transferService.createTicket(BigInt(userId), BigInt(id))
  }

  /**
   * 票据直链流（@Public：票据即身份，免 Authorization 头）。
   * 限流单独放宽到 600 次/分/IP：视频拖动进度条会触发多次 Range 请求，用全局 300 会挤占其它接口额度。
   */
  @Public()
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @SkipTransform()
  @Get('stream/:id')
  @ApiOperation({ summary: '票据直链流（免登录；inline 预览 / attachment 下载，支持 Range）' })
  async stream(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: FileStreamQueryDto,
    @Headers('range') range: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    await this.transferService.streamByTicket(BigInt(id), query, query.mode ?? 'inline', range ?? null, res)
  }
}
