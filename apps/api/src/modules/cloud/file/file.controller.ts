import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Query, Res } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Response } from 'express'
import { CurrentUser } from '../../../gateway/decorators/current-user.decorator'
import { OperationLog } from '../../../gateway/decorators/operation-log.decorator'
import { RequirePermission } from '../../../gateway/decorators/require-permission.decorator'
import { SkipTransform } from '../../../gateway/decorators/skip-transform.decorator'
import { FileListQueryDto, FilePathQueryDto, MkdirDto, RenameDto, SetPublicDto } from './dto/file.dto'
import { FileService } from './file.service'

@ApiTags('云盘-我的文件')
@ApiBearerAuth()
@Controller('cloud/file')
export class FileController {
  constructor(private readonly fileService: FileService) {}

  @Get('list')
  @RequirePermission('cloud:file:list')
  @ApiOperation({ summary: '目录内容（文件夹在前，文件按修改时间倒序）' })
  list(@CurrentUser('userId') userId: string, @Query() query: FileListQueryDto) {
    return this.fileService.list(BigInt(userId), query)
  }

  @Get('path')
  @RequirePermission('cloud:file:list')
  @ApiOperation({ summary: '面包屑链（从根到当前目录）' })
  path(@CurrentUser('userId') userId: string, @Query() query: FilePathQueryDto) {
    return this.fileService.path(BigInt(userId), BigInt(query.id))
  }

  @Get('quota')
  @RequirePermission('cloud:file:list')
  @ApiOperation({ summary: '我的配额（cloud_usage 懒创建）' })
  quota(@CurrentUser('userId') userId: string) {
    return this.fileService.getQuota(BigInt(userId))
  }

  @Post('mkdir')
  @RequirePermission('cloud:file:mkdir')
  @OperationLog('云盘', '新建文件夹')
  @ApiOperation({ summary: '新建文件夹（同名自动加 (1)）' })
  mkdir(@CurrentUser('userId') userId: string, @Body() dto: MkdirDto) {
    return this.fileService.mkdir(BigInt(userId), dto)
  }

  @Post('rename')
  @RequirePermission('cloud:file:rename')
  @OperationLog('云盘', '重命名')
  @ApiOperation({ summary: '重命名（同名冲突阻止）' })
  rename(@CurrentUser('userId') userId: string, @Body() dto: RenameDto) {
    return this.fileService.rename(BigInt(userId), dto)
  }

  @Post('set-public')
  @RequirePermission('cloud:file:public')
  @OperationLog('云盘', '设为公开')
  @ApiOperation({ summary: '设为公开 / 取消公开（仅标记自身，公开性访问时上溯判定）' })
  setPublic(@CurrentUser('userId') userId: string, @Body() dto: SetPublicDto) {
    return this.fileService.setPublic(BigInt(userId), dto)
  }

  @Delete(':id')
  @RequirePermission('cloud:file:delete')
  @OperationLog('云盘', '删除文件')
  @ApiOperation({ summary: '删除（软删入回收站，R2 只标自身）' })
  remove(@CurrentUser('userId') userId: string, @Param('id', ParseIntPipe) id: number) {
    return this.fileService.remove(BigInt(userId), BigInt(id))
  }

  @Get('avatar/:id')
  @SkipTransform()
  @RequirePermission('cloud:file:list')
  @ApiOperation({ summary: '头像预览（仅当前用户自己的头像可读）' })
  async avatar(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ): Promise<void> {
    const { stream, mime } = await this.fileService.getAvatarStream(BigInt(id), BigInt(userId))
    res.setHeader('Content-Type', mime || 'application/octet-stream')
    res.setHeader('Cache-Control', 'no-cache')
    stream.pipe(res)
  }
}
