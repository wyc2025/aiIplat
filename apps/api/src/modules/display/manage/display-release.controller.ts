import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../../gateway/decorators/current-user.decorator'
import { OperationLog } from '../../../gateway/decorators/operation-log.decorator'
import { SaveReleaseDto, SetReleasePinDto } from './dto/display-release.dto'
import { DisplayReleaseService } from './display-release.service'

/**
 * 展示应用版本检查点端点（P20 T167，API §28.3）。
 *
 * 定位是**存档**而非上线：把页面内容存成一个可回退的版本，随时「恢复到工作区」。
 * 与站点发布刻意分治（见 `DisplayReleaseService` 类注释）——展示应用不必随站点发布。
 * 登录态 + 属主自服务；写操作挂 `@OperationLog`。
 */
@ApiTags('应用平台-展示应用版本')
@ApiBearerAuth()
@Controller('display')
export class DisplayReleaseController {
  constructor(private readonly releases: DisplayReleaseService) {}

  @Get(':id/releases')
  @ApiParam({ name: 'id', description: '展示应用 id' })
  @ApiOperation({ summary: '版本检查点列表（新 → 旧）' })
  list(@CurrentUser('userId') userId: string, @Param('id', ParseIntPipe) id: number) {
    return this.releases.list(BigInt(userId), BigInt(id))
  }

  @Post(':id/releases')
  @OperationLog('展示应用', '保存版本')
  @ApiParam({ name: 'id', description: '展示应用 id' })
  @ApiOperation({
    summary: '把当前页面内容保存为一个版本（还没有页面文件 → 40001；正在保存 → 50022）',
  })
  save(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveReleaseDto,
  ) {
    return this.releases.save(BigInt(userId), BigInt(id), dto.label)
  }

  @Post(':id/releases/:releaseId/restore')
  @OperationLog('展示应用', '恢复版本')
  @ApiParam({ name: 'id', description: '展示应用 id' })
  @ApiParam({ name: 'releaseId', description: '版本 id' })
  @ApiOperation({
    summary: '恢复到工作区：现有内容先软删进回收站，再写回该版本（恢复错了可再撤回）',
  })
  restore(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseIntPipe) id: number,
    @Param('releaseId', ParseIntPipe) releaseId: number,
  ) {
    return this.releases.restore(BigInt(userId), BigInt(id), BigInt(releaseId))
  }

  @Put(':id/releases/:releaseId/pin')
  @OperationLog('展示应用', '锁定/解锁版本')
  @ApiParam({ name: 'id', description: '展示应用 id' })
  @ApiParam({ name: 'releaseId', description: '版本 id' })
  @ApiOperation({ summary: '锁定 / 解锁版本（锁定后豁免删除）' })
  pin(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseIntPipe) id: number,
    @Param('releaseId', ParseIntPipe) releaseId: number,
    @Body() dto: SetReleasePinDto,
  ) {
    return this.releases.pin(BigInt(userId), BigInt(id), BigInt(releaseId), dto.pinned)
  }

  @Delete(':id/releases/:releaseId')
  @OperationLog('展示应用', '删除版本')
  @ApiParam({ name: 'id', description: '展示应用 id' })
  @ApiParam({ name: 'releaseId', description: '版本 id' })
  @ApiOperation({ summary: '删除版本（已锁定的需先解锁，否则 50022）' })
  remove(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseIntPipe) id: number,
    @Param('releaseId', ParseIntPipe) releaseId: number,
  ) {
    return this.releases.remove(BigInt(userId), BigInt(id), BigInt(releaseId))
  }
}
