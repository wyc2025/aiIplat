import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator'

/** slug 正则（R11，校验失败 40103；保留字黑名单在 Service 层判断） */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{2,31}$/

/** 开站即发表的文章：'all' = 内容池全部已发布文章；或文章 ID 数组（P7 D73） */
@ValidatorConstraint({ name: 'allOrArticleIds', async: false })
export class AllOrArticleIdsConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (value === 'all') return true
    return (
      Array.isArray(value) &&
      value.length <= 1000 &&
      value.every((v) => typeof v === 'number' && Number.isInteger(v) && v >= 1)
    )
  }

  defaultMessage(): string {
    return "publishArticleIds 仅支持 'all' 或文章 ID 数组"
  }
}

/** 创建站点 */
export class CreateSiteDto {
  @ApiProperty({ description: '站点标识（3~32 位小写字母/数字/连字符，字母或数字开头，非保留字）', example: 'myblog' })
  @IsString()
  @Matches(SLUG_PATTERN, { message: 'slug 需为 3~32 位小写字母/数字/连字符，且以字母或数字开头' })
  slug!: string

  @ApiProperty({ description: '站点标题（1~50 字）' })
  @IsString()
  @Length(1, 50, { message: '站点标题需 1~50 字' })
  title!: string

  @ApiPropertyOptional({ description: '站点描述（≤200 字）' })
  @IsOptional()
  @IsString()
  @Length(0, 200, { message: '站点描述不能超过 200 字' })
  description?: string

  @ApiPropertyOptional({
    description: "开站即发表的文章：'all' = 内容池全部已发布文章（缺省）；或文章 ID 数组",
    example: 'all',
  })
  @IsOptional()
  @Validate(AllOrArticleIdsConstraint)
  publishArticleIds?: 'all' | number[]
}

/** 编辑站点（全部可选，至少一项生效） */
export class UpdateSiteDto {
  @ApiPropertyOptional({ description: '站点标题（1~50 字）' })
  @IsOptional()
  @IsString()
  @Length(1, 50, { message: '站点标题需 1~50 字' })
  title?: string

  @ApiPropertyOptional({ description: '站点描述（≤200 字，空串清空）' })
  @IsOptional()
  @IsString()
  @Length(0, 200, { message: '站点描述不能超过 200 字' })
  description?: string

  @ApiPropertyOptional({ description: '站点标识（变更后旧链接立即全部失效）' })
  @IsOptional()
  @IsString()
  @Matches(SLUG_PATTERN, { message: 'slug 需为 3~32 位小写字母/数字/连字符，且以字母或数字开头' })
  slug?: string

  @ApiPropertyOptional({ description: '站点状态（1 启用 / 0 停用，停用即开放层全 404）', enum: [0, 1] })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn([0, 1], { message: 'status 仅允许 0（停用）/ 1（启用）' })
  status?: number

  @ApiPropertyOptional({ description: '评论审核开关（1 开=需审核 / 0 关=直过审）', enum: [0, 1] })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn([0, 1], { message: 'commentAudit 仅允许 0 / 1' })
  commentAudit?: number

  /**
   * SPA 回退入口（P9 T94 / D81 / R81）：`'index.html'` = 开启（无扩展名路径回退到该文件）、
   * `null` = 关闭（保持 P7 前行为）；其他值一律 40001。只允许这两个值，避免任写路径造成越权读文件。
   */
  @ApiPropertyOptional({
    description: "SPA 回退入口：'index.html' 开启 / null 关闭",
    nullable: true,
    example: 'index.html',
  })
  @IsOptional()
  @IsIn(['index.html', null], { message: "spaFallback 仅允许 'index.html' 或 null" })
  spaFallback?: string | null
}
