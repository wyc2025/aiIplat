import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsBoolean, IsOptional, IsString, Length, Matches, ValidateNested } from 'class-validator'

/**
 * 从云盘文件导入文章（P8 T88）：
 * 只接收 fileId，内容读取走 CloudFacade（域边界），解析在本域完成；
 * 该接口**只解析不落库**，返回结果供前端填入表单，由用户确认后再走常规新建/编辑。
 */
export class ImportArticleDto {
  @ApiProperty({ description: '云盘文件 ID（须为本人、未删除、md/markdown/txt 且 ≤2MB）' })
  @Matches(/^\d+$/, { message: 'fileId 非法' })
  fileId!: string
}

/** 排版选项（缺省 = 三档全开，即"标准排版"） */
export class FormatOptionsDto {
  @ApiPropertyOptional({ description: '结构规整（标题/引用/列表符号/围栏/块间空行）', default: true })
  @IsOptional()
  @IsBoolean()
  structure?: boolean

  @ApiPropertyOptional({ description: '标点与符号统一（强调符号、中文省略号）', default: true })
  @IsOptional()
  @IsBoolean()
  punctuation?: boolean

  @ApiPropertyOptional({ description: '中英文/中文数字之间补空格（跳过代码与链接地址）', default: true })
  @IsOptional()
  @IsBoolean()
  cjkSpacing?: boolean
}

/**
 * 一键排版（P8 T89）：入参为待排版的正文，返回排版结果与命中规则；
 * **不落库**（前端做 diff 预览，用户确认后再保存文章）。
 */
export class FormatArticleDto {
  @ApiProperty({ description: '待排版正文 markdown（≤20 万字符，与文章正文同口径）' })
  @IsString()
  @Length(1, 200000, { message: '正文不能超过 20 万字符' })
  contentMd!: string

  @ApiPropertyOptional({ description: '排版选项（缺省三档全开）', type: FormatOptionsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => FormatOptionsDto)
  options?: FormatOptionsDto
}
