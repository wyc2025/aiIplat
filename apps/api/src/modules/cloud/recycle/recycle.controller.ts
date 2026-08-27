import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../../gateway/decorators/current-user.decorator'
import { OperationLog } from '../../../gateway/decorators/operation-log.decorator'
import { RequirePermission } from '../../../gateway/decorators/require-permission.decorator'
import { RecycleListQueryDto, RecyclePathQueryDto, RecycleRestoreDto } from './dto/recycle.dto'
import { RecycleService } from './recycle.service'

/** 回收站（cloud:recycle:*） */
@ApiTags('云盘-回收站')
@ApiBearerAuth()
@Controller('cloud/recycle')
export class RecycleController {
  constructor(private readonly recycleService: RecycleService) {}

  @Get('list')
  @RequirePermission('cloud:recycle:list')
  @ApiOperation({ summary: '回收站列表（无 parentId=顶层被删项；带 parentId=只读浏览被删文件夹内容）' })
  list(@CurrentUser('userId') userId: string, @Query() query: RecycleListQueryDto) {
    return this.recycleService.list(BigInt(userId), query)
  }

  @Get('path')
  @RequirePermission('cloud:recycle:list')
  @ApiOperation({ summary: '回收站面包屑链（根固定为回收站）' })
  path(@CurrentUser('userId') userId: string, @Query() query: RecyclePathQueryDto) {
    return this.recycleService.path(BigInt(userId), BigInt(query.id ?? 0))
  }

  @Post('restore')
  @RequirePermission('cloud:recycle:restore')
  @OperationLog('云盘', '还原文件')
  @ApiOperation({ summary: '还原（R5：父可用原位、否则根目录，同名自动 (1)）' })
  restore(@CurrentUser('userId') userId: string, @Body() dto: RecycleRestoreDto) {
    return this.recycleService.restore(BigInt(userId), BigInt(dto.id))
  }

  @Delete('clear')
  @RequirePermission('cloud:recycle:delete')
  @OperationLog('云盘', '清空回收站')
  @ApiOperation({ summary: '清空回收站（全部顶层被删项递归删除）' })
  clear(@CurrentUser('userId') userId: string) {
    return this.recycleService.clear(BigInt(userId))
  }

  @Delete(':id')
  @RequirePermission('cloud:recycle:delete')
  @OperationLog('云盘', '彻底删除文件')
  @ApiOperation({ summary: '彻底删除（递归子树 + 连带删分享 + used 回扣）' })
  purge(@CurrentUser('userId') userId: string, @Param('id', ParseIntPipe) id: number) {
    return this.recycleService.purge(BigInt(userId), BigInt(id))
  }
}
