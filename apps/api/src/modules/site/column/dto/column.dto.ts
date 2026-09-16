import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, Length, Min, ValidateNested } from 'class-validator'

/**
 * 栏目列表查询（P7 D73：内容池化后栏目归用户，列表不再带 siteId，返回全部本人栏目 + 每栏目的可见站点）。
 */
export class ColumnQueryDto {}

/** 栏目站点显隐项（P7 D73） */
export class ColumnSiteInput {
  @ApiProperty({ description: '站点 ID（不存在或非属主 → 40119）' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  siteId!: number

  @ApiPropertyOptional({ description: '该站内排序值（升序，缺省沿用现有）' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sort?: number
}

/** 替换式管理栏目在哪些站点展示（空数组 = 全部站点不展示） */
export class ColumnSitesDto {
  @ApiProperty({ description: '展示站点集合（替换式；空数组 = 全站不展示）', type: [ColumnSiteInput] })
  @IsArray()
  @ArrayMaxSize(100, { message: '站点最多 100 个' })
  @ValidateNested({ each: true })
  @Type(() => ColumnSiteInput)
  sites!: ColumnSiteInput[]
}

/** 创建栏目（R6：≤3 级，层级校验在 Service；同级同名不去重；siteIds 缺省 = 全部站点可见） */
export class CreateColumnDto {
  @ApiPropertyOptional({
    description: '展示站点 ID 数组（缺省 = 用户全部站点可见；不存在或非属主 → 40119）',
    type: [Number],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100, { message: '站点最多 100 个' })
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  siteIds?: number[]

  @ApiPropertyOptional({ description: '父栏目 ID（0 = 根，缺省 0）', default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  parentId: number = 0

  @ApiProperty({ description: '栏目名称（1~32 字）' })
  @IsString()
  @Length(1, 32, { message: '栏目名称需 1~32 字' })
  name!: string

  @ApiPropertyOptional({ description: '同级排序值（升序，缺省 0）', default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sort: number = 0
}

/** 编辑栏目（name/sort/parentId 均可选；换父级禁止指向自身或后代且不得超 3 级；属主按实体反查） */
export class UpdateColumnDto {
  @ApiPropertyOptional({ description: '栏目名称（1~32 字）' })
  @IsOptional()
  @IsString()
  @Length(1, 32, { message: '栏目名称需 1~32 字' })
  name?: string

  @ApiPropertyOptional({ description: '同级排序值（升序）' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sort?: number

  @ApiPropertyOptional({ description: '新父栏目 ID（0 = 移到根）' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  parentId?: number
}
