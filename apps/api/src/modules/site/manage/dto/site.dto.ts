import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsString, Length, Matches } from 'class-validator'

/** slug 正则（R11，校验失败 40103；保留字黑名单在 Service 层判断） */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{2,31}$/

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
}
