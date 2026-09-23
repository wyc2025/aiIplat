import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface'
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger'
import type { Response } from 'express'
import { readAppMaxAttachmentSize, readAppMaxImportSize } from '../../../config/app.config'
import { CurrentUser } from '../../../gateway/decorators/current-user.decorator'
import { OperationLog } from '../../../gateway/decorators/operation-log.decorator'
import { SkipTransform } from '../../../gateway/decorators/skip-transform.decorator'
import { createTmpUploadStorage } from '../../../infra/storage/tmp-storage'
import { ConfirmImportDto, ExportQueryDto, ImportQueryDto } from './dto/import.dto'
import { ImportService } from './import.service'

/** CSV 导入上传配置（Multer 磁盘流；上限放宽 4 倍，超 5MB 由服务层判 50006 给出精确提示） */
const IMPORT_OPTIONS: MulterOptions = {
  storage: createTmpUploadStorage(),
  defParamCharset: 'utf8',
  limits: { fileSize: readAppMaxImportSize() * 4, files: 1 },
}

/** 附件字段上传配置（单文件 ≤10MB，服务端强制落 /app-attachments/{appCode}/） */
const ATTACHMENT_OPTIONS: MulterOptions = {
  storage: createTmpUploadStorage(),
  defParamCharset: 'utf8',
  limits: { fileSize: readAppMaxAttachmentSize(), files: 1 },
}

/**
 * 导入导出与附件（P11 T103，API-P11 §1.5）。
 * 全部登录态、属主自服务口径；导出为流式响应（@SkipTransform）。
 */
@ApiTags('应用平台-导入导出与附件')
@ApiBearerAuth()
@Controller('app')
export class ImportController {
  constructor(private readonly importService: ImportService) {}

  @Post(':code/import')
  @UseInterceptors(FileInterceptor('file', IMPORT_OPTIONS))
  @OperationLog('应用中心', 'CSV 导入')
  @ApiConsumes('multipart/form-data')
  @ApiParam({ name: 'code', description: '应用 code' })
  @ApiOperation({ summary: '上传 CSV（≤5MB）→ 解析 + 自动映射 + 前 5 行预览，待确认' })
  prepareImport(
    @CurrentUser('userId') userId: string,
    @Param('code') code: string,
    @Query() query: ImportQueryDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.importService.prepareImport(BigInt(userId), code, query.table, file)
  }

  @Post(':code/import/:taskId/confirm')
  @OperationLog('应用中心', '确认 CSV 导入')
  @ApiParam({ name: 'code', description: '应用 code' })
  @ApiOperation({ summary: '确认映射 → 异步导入（进度轮询 GET /app/import/:taskId）' })
  confirmImport(
    @CurrentUser('userId') userId: string,
    @Param('code') code: string,
    @Param('taskId') taskId: string,
    @Body() dto: ConfirmImportDto,
  ) {
    return this.importService.confirmImport(BigInt(userId), code, taskId, dto)
  }

  @Get('import/:taskId')
  @ApiParam({ name: 'taskId', description: '导入任务 id' })
  @ApiOperation({ summary: '导入进度（status/total/done/errors[{row,reason}]）' })
  progress(@CurrentUser('userId') userId: string, @Param('taskId') taskId: string) {
    return this.importService.getProgress(BigInt(userId), taskId)
  }

  @Get(':code/export')
  @SkipTransform()
  @OperationLog('应用中心', 'CSV 导出')
  @ApiParam({ name: 'code', description: '应用 code' })
  @ApiOperation({ summary: '流式导出全表 CSV（≤5 万行，超出截断并在尾注释说明）' })
  exportCsv(
    @CurrentUser('userId') userId: string,
    @Param('code') code: string,
    @Query() query: ExportQueryDto,
    @Res() res: Response,
  ) {
    return this.importService.exportCsv(BigInt(userId), code, query.table, res)
  }

  @Post(':code/attachment')
  @UseInterceptors(FileInterceptor('file', ATTACHMENT_OPTIONS))
  @OperationLog('应用中心', '上传附件')
  @ApiConsumes('multipart/form-data')
  @ApiParam({ name: 'code', description: '应用 code' })
  @ApiOperation({ summary: '附件字段上传（强制落 /app-attachments/{appCode}/，占云盘配额）' })
  uploadAttachment(
    @CurrentUser('userId') userId: string,
    @Param('code') code: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.importService.uploadAttachment(BigInt(userId), code, file)
  }
}
