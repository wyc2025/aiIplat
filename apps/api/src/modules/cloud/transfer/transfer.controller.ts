import { Body, Controller, Get, Headers, Param, ParseIntPipe, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Response } from 'express'
import { CurrentUser } from '../../../gateway/decorators/current-user.decorator'
import { OperationLog } from '../../../gateway/decorators/operation-log.decorator'
import { RequirePermission } from '../../../gateway/decorators/require-permission.decorator'
import { SkipTransform } from '../../../gateway/decorators/skip-transform.decorator'
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
}
