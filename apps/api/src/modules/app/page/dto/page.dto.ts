import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
} from 'class-validator'
import { PAGE_ROUTE_PATTERN } from '../../schema/schema.constants'

/** 新建功能页 */
export class CreatePageDto {
  @ApiProperty({ description: '功能页名称（1~50 字）', example: '文章管理' })
  @IsString()
  @Length(1, 50, { message: '功能页名称需 1~50 字' })
  name!: string

  @ApiProperty({ description: '应用内相对路由（如 article）', example: 'article' })
  @IsString()
  @Matches(PAGE_ROUTE_PATTERN, { message: 'route 需为小写字母数字与连字符/斜杠' })
  route!: string

  @ApiProperty({ description: '功能页模式 JSON（§5；过校验，失败 50004）' })
  @IsObject()
  schema!: Record<string, unknown>

  @ApiPropertyOptional({ description: '生成方式', enum: ['ai', 'manual'] })
  @IsOptional()
  @IsIn(['ai', 'manual'], { message: "genBy 仅允许 'ai' / 'manual'" })
  genBy?: 'ai' | 'manual'
}

/** 更新功能页（schema/name/sort） */
export class UpdatePageDto {
  @ApiPropertyOptional({ description: '功能页名称（1~50 字）' })
  @IsOptional()
  @IsString()
  @Length(1, 50, { message: '功能页名称需 1~50 字' })
  name?: string

  @ApiPropertyOptional({ description: '功能页模式 JSON（过校验，失败 50004）' })
  @IsOptional()
  @IsObject()
  schema?: Record<string, unknown>

  @ApiPropertyOptional({ description: '排序（升序）' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sort?: number
}

/** 动作执行（R90：多表写整体事务） */
export class PageActionDto {
  @ApiProperty({ description: '应用 code' })
  @IsString()
  appCode!: string

  @ApiProperty({ description: '功能页 code' })
  @IsString()
  pageCode!: string

  @ApiProperty({ description: '动作名（须在页面 schema.actions 中声明）' })
  @IsString()
  action!: string

  @ApiPropertyOptional({ description: '动作参数（字段值；多表时按表名分组）' })
  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>
}

// P14 R126：`PublishPageDto`（展示页公开开关入参）随 display 展示页废弃移除。
