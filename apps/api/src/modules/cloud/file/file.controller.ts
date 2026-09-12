import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, Res } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Response } from 'express'
import { CurrentUser } from '../../../gateway/decorators/current-user.decorator'
import { OperationLog } from '../../../gateway/decorators/operation-log.decorator'
import { RequirePermission } from '../../../gateway/decorators/require-permission.decorator'
import { SkipTransform } from '../../../gateway/decorators/skip-transform.decorator'
import {
  FileListQueryDto,
  FilePathQueryDto,
  MkdirDto,
  MoveFileDto,
  RenameDto,
  SetPublicDto,
  SetPublicLinkDto,
  UpdateContentDto,
} from './dto/file.dto'
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

  @Post(':id/move')
  @RequirePermission('cloud:file:upload')
  @OperationLog('云盘', '移动')
  @ApiOperation({
    summary: '移动（P4d：防环/站点根/回收站 30019 + R4 同名 + targetPublic 公开继承标记 R39）',
  })
  move(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MoveFileDto,
  ) {
    return this.fileService.move(BigInt(userId), BigInt(id), dto)
  }

  @Post('set-public')
  @RequirePermission('cloud:file:public')
  @OperationLog('云盘', '设为公开')
  @ApiOperation({ summary: '设为公开 / 取消公开（仅标记自身，公开性访问时上溯判定）' })
  setPublic(@CurrentUser('userId') userId: string, @Body() dto: SetPublicDto) {
    return this.fileService.setPublic(BigInt(userId), dto)
  }

  @Post(':id/public')
  @RequirePermission('cloud:file:public')
  @OperationLog('云盘', '设为公开')
  @ApiOperation({ summary: '设为公开并获取公开链接（P4c：生成 public_token，幂等；文件夹可传 allowListing）' })
  createPublicLink(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetPublicLinkDto,
  ) {
    return this.fileService.createPublicLink(BigInt(userId), BigInt(id), dto)
  }

  @Delete(':id/public')
  @RequirePermission('cloud:file:public')
  @OperationLog('云盘', '取消公开')
  @ApiOperation({ summary: '取消公开（P4c R27：token 轮换置空 + is_public 归 0，旧链接立即失效）' })
  cancelPublicLink(@CurrentUser('userId') userId: string, @Param('id', ParseIntPipe) id: number) {
    return this.fileService.cancelPublicLink(BigInt(userId), BigInt(id))
  }

  @Put(':id/content')
  @RequirePermission('cloud:file:upload')
  @OperationLog('云盘', '在线编辑保存')
  @ApiOperation({ summary: '在线编辑保存（更新行语义：fileId/URL 不变，开放层立即生效）' })
  saveContent(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateContentDto,
  ) {
    return this.fileService.saveFileContent(BigInt(userId), BigInt(id), dto)
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
