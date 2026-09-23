import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator'

/** R95 查询 op 白名单 */
export const QUERY_FILTER_OPS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'in'] as const
export type QueryFilterOp = (typeof QUERY_FILTER_OPS)[number]

/** 过滤项 */
export class QueryFilterDto {
  @ApiProperty({ description: '字段名' })
  @IsString()
  f!: string

  @ApiProperty({ description: '比较操作（白名单）', enum: QUERY_FILTER_OPS })
  @IsIn(QUERY_FILTER_OPS as unknown as string[], { message: 'filter op 不在白名单内' })
  op!: QueryFilterOp

  @ApiPropertyOptional({ description: '比较值（in 传数组）' })
  @IsOptional()
  v?: unknown
}

/** 排序项 */
export class QuerySortDto {
  @ApiProperty({ description: '字段名' })
  @IsString()
  f!: string

  @ApiProperty({ description: '方向', enum: ['asc', 'desc'] })
  @IsIn(['asc', 'desc'], { message: "sort dir 仅允许 'asc' / 'desc'" })
  dir!: 'asc' | 'desc'
}

/** 展开项（ref ≤1 层） */
export class QueryExpandDto {
  @ApiProperty({ description: 'ref 字段名' })
  @IsString()
  f!: string

  @ApiPropertyOptional({ description: '目标表要回的字段（缺省全部）', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  fields?: string[]
}

/** 沙箱数据查询 DSL（ARCHITECTURE-P11 §4 / R95） */
export class DataQueryDto {
  @ApiProperty({ description: '应用 code（表名在应用内解析，必填）' })
  @IsString()
  appCode!: string

  @ApiProperty({ description: 'op 白名单', enum: ['list', 'get', 'count'] })
  @IsIn(['list', 'get', 'count'], { message: "op 仅允许 'list' / 'get' / 'count'" })
  op!: 'list' | 'get' | 'count'

  @ApiProperty({ description: '逻辑表名' })
  @IsString()
  table!: string

  @ApiPropertyOptional({ description: '过滤条件', type: [QueryFilterDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QueryFilterDto)
  filter?: QueryFilterDto[]

  @ApiPropertyOptional({ description: '排序', type: [QuerySortDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuerySortDto)
  sort?: QuerySortDto[]

  @ApiPropertyOptional({ description: '页码（从 1 起，默认 1）' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number

  @ApiPropertyOptional({ description: '每页条数（默认 20，上限 100）' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100, { message: 'size 上限 100' })
  size?: number

  @ApiPropertyOptional({ description: 'ref 展开（≤1 层）', type: [QueryExpandDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QueryExpandDto)
  expand?: QueryExpandDto[]

  @ApiPropertyOptional({ description: 'op=get 时按 rowId 取单行' })
  @IsOptional()
  @IsString()
  rowId?: string
}

/** 单行查询（get 语义糖） */
export class RecordQueryDto {
  @ApiProperty({ description: '应用 code' })
  @IsString()
  appCode!: string

  @ApiProperty({ description: '逻辑表名' })
  @IsString()
  table!: string

  @ApiProperty({ description: '行 rowId' })
  @IsString()
  rowId!: string
}
