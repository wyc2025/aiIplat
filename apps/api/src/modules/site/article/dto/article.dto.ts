import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator'

/** 创建文章 */
export class CreateArticleDto {
  @ApiProperty({ description: '栏目 ID（须为本站栏目）' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  columnId!: number

  @ApiProperty({ description: '标题（1~100 字）' })
  @IsString()
  @Length(1, 100, { message: '标题需 1~100 字' })
  title!: string

  @ApiPropertyOptional({ description: '摘要（≤200 字，留空自动取正文纯文本前 100 字）' })
  @IsOptional()
  @IsString()
  @Length(0, 200, { message: '摘要不能超过 200 字' })
  summary?: string

  @ApiPropertyOptional({ description: '标签 ID 数组', type: [Number] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(0)
  @ArrayMaxSize(20, { message: '标签最多 20 个' })
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  tagIds?: number[]

  @ApiPropertyOptional({ description: '封面相对站点根路径（必须 media/ 前缀，如 media/xxx.png）' })
  @IsOptional()
  @IsString()
  @Length(1, 255, { message: '封面路径不能超过 255 字符' })
  coverPath?: string

  @ApiProperty({ description: '正文 markdown（≤20 万字符）' })
  @IsString()
  @Length(1, 200000, { message: '正文不能超过 20 万字符' })
  contentMd!: string

  @ApiProperty({ description: '状态（0 草稿 / 1 发布）', enum: [0, 1] })
  @Type(() => Number)
  @IsInt()
  @IsIn([0, 1], { message: 'status 仅允许 0（草稿）/ 1（发布）' })
  status!: number
}

/** 编辑文章（全可选，提供即更新；tagIds 提供即整体重建） */
export class UpdateArticleDto {
  @ApiPropertyOptional({ description: '栏目 ID' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  columnId?: number

  @ApiPropertyOptional({ description: '标题（1~100 字）' })
  @IsOptional()
  @IsString()
  @Length(1, 100, { message: '标题需 1~100 字' })
  title?: string

  @ApiPropertyOptional({ description: '摘要（≤200 字；空串触发自动生成）' })
  @IsOptional()
  @IsString()
  @Length(0, 200, { message: '摘要不能超过 200 字' })
  summary?: string

  @ApiPropertyOptional({ description: '标签 ID 数组（提供即整体重建）', type: [Number] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20, { message: '标签最多 20 个' })
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  tagIds?: number[]

  @ApiPropertyOptional({ description: '封面（必须 media/ 前缀；空串清除，前缀校验在 Service 层）' })
  @IsOptional()
  @IsString()
  @Length(0, 255, { message: '封面路径不能超过 255 字符' })
  coverPath?: string

  @ApiPropertyOptional({ description: '正文 markdown' })
  @IsOptional()
  @IsString()
  @Length(1, 200000, { message: '正文不能超过 20 万字符' })
  contentMd?: string

  @ApiPropertyOptional({ description: '状态（0 草稿 / 1 发布；首次发布写发布时间）', enum: [0, 1] })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn([0, 1], { message: 'status 仅允许 0（草稿）/ 1（发布）' })
  status?: number
}

/** 发布/下架 */
export class UpdateArticleStatusDto {
  @ApiProperty({ description: '目标状态（0 下架 / 1 发布）', enum: [0, 1] })
  @Type(() => Number)
  @IsInt()
  @IsIn([0, 1], { message: 'status 仅允许 0（下架）/ 1（发布）' })
  status!: number
}
