import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsInt, IsOptional, Min } from 'class-validator'

/** 回收站列表查询（parentId 缺省或 0 = 顶层被删项；带 parentId = 只读浏览被删文件夹内容） */
export class RecycleListQueryDto {
  @ApiPropertyOptional({ description: '被删文件夹 ID（0 或缺省 = 顶层被删项）', default: undefined })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  parentId?: number
}

/** 回收站面包屑链查询 */
export class RecyclePathQueryDto {
  @ApiPropertyOptional({ description: '被删文件夹 ID（0 或缺省 = 回收站根）', default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  id?: number = 0
}

/** 还原 */
export class RecycleRestoreDto {
  @ApiPropertyOptional({ description: '被删项 ID' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  id!: number
}
