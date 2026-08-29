import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator'

/** 开放文章列表查询（契约：pageSize 上限 50，D10） */
export class OpenArticlesQueryDto {
  @ApiPropertyOptional({ description: '按栏目筛选' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  columnId?: number

  @ApiPropertyOptional({ description: '按标签筛选' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  tagId?: number

  @ApiPropertyOptional({ description: '标题关键词（模糊）' })
  @IsOptional()
  @IsString()
  @Length(0, 100)
  keyword?: string

  @ApiPropertyOptional({ description: '页码，从 1 起', default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageNo: number = 1

  @ApiPropertyOptional({ description: '每页条数（上限 50）', default: 10 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50, { message: 'pageSize 上限为 50' })
  pageSize: number = 10
}

/** 开放评论列表分页（pageSize 上限 50） */
export class OpenCommentPageDto {
  @ApiPropertyOptional({ description: '页码，从 1 起', default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageNo: number = 1

  @ApiPropertyOptional({ description: '每页条数（上限 50）', default: 10 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50, { message: 'pageSize 上限为 50' })
  pageSize: number = 10
}

/** 访客提交评论（昵称制：昵称 + 内容，无邮箱无注册，D9） */
export class CreateOpenCommentDto {
  @ApiProperty({ description: '访客昵称（1~32 字）' })
  @IsString()
  @Length(1, 32, { message: '昵称需 1~32 字' })
  nickname!: string

  @ApiProperty({ description: '评论内容（1~500 字）' })
  @IsString()
  @Length(1, 500, { message: '评论内容需 1~500 字' })
  content!: string
}
