import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsString, Length, Min } from 'class-validator'
import { SitePageQueryDto } from '../../dto/site-id.dto'

/** 评论列表查询（P4E T61：必带 siteId；筛选：审核状态/文章/昵称关键词） */
export class CommentQueryDto extends SitePageQueryDto {
  @ApiPropertyOptional({ description: '按审核状态筛选（0 待审核 / 1 已通过 / 2 已驳回）', enum: [0, 1, 2] })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn([0, 1, 2])
  auditStatus?: number

  @ApiPropertyOptional({ description: '按文章筛选' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  articleId?: number

  @ApiPropertyOptional({ description: '昵称关键词（模糊）' })
  @IsOptional()
  @IsString()
  @Length(0, 50)
  keyword?: string
}

/**
 * 作者回复评论（P6 T78 / D69 / R71）：
 * trim 后 ≤500 字；**空字符串或 null = 清除已有回复**（reply_content/reply_at 置 NULL）。
 */
export class ReplyCommentDto {
  @ApiPropertyOptional({ description: '回复内容（trim 后 ≤500 字；空串或 null = 清除已有回复）', nullable: true })
  @IsOptional()
  @IsString()
  @Length(0, 500, { message: '回复内容最多 500 字' })
  content?: string | null
}

/** 审核评论（1 通过 / 2 驳回；属主按实体反查） */
export class AuditCommentDto {
  @ApiProperty({ description: '审核结果（1 通过 / 2 驳回）', enum: [1, 2] })
  @Type(() => Number)
  @IsInt()
  @IsIn([1, 2], { message: 'auditStatus 仅允许 1（通过）/ 2（驳回）' })
  auditStatus!: number
}
