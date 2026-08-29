import { Controller, Get, Headers, Param, ParseIntPipe, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Response } from 'express'
import { CurrentUser } from '../../../gateway/decorators/current-user.decorator'
import { OperationLog } from '../../../gateway/decorators/operation-log.decorator'
import { RequirePermission } from '../../../gateway/decorators/require-permission.decorator'
import { SkipTransform } from '../../../gateway/decorators/skip-transform.decorator'
import { UploadQueryDto } from './dto/transfer.dto'
import { CLOUD_UPLOAD_OPTIONS } from './tmp-storage'
import { TransferService } from './transfer.service'

/** 上传 / 预览 / 下载（与 FileController 同前缀，路由不冲突） */
@ApiTags('云盘-文件传输')
@ApiBearerAuth()
@Controller('cloud/file')
export class TransferController {
  constructor(private readonly transferService: TransferService) {}

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
