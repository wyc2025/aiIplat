import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Length, MaxLength, Min } from 'class-validator'

/** 目录内容查询 */
export class FileListQueryDto {
  @ApiPropertyOptional({ description: '父目录 ID，缺省 0=根目录', default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  parentId: number = 0
}

/** 面包屑链查询 */
export class FilePathQueryDto {
  @ApiProperty({ description: '目标目录 ID（0 表示根目录）' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  id!: number
}

/** 新建文件夹 */
export class MkdirDto {
  @ApiProperty({ description: '父目录 ID，0=根目录' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  parentId!: number

  @ApiProperty({ description: '文件夹名称（≤64 字符）' })
  @IsString()
  @IsNotEmpty({ message: '文件夹名称不能为空' })
  @MaxLength(64, { message: '名称不能超过 64 字符' })
  name!: string
}

/** 设为公开 / 取消公开（P4a：公开性仅标记自身，级联语义由访问时上溯判定承担） */
export class SetPublicDto {
  @ApiProperty({ description: '文件/文件夹 ID' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  id!: number

  @ApiProperty({ description: '是否公开（1 设为公开 / 0 取消公开=显式阻断；子树语义由上溯判定承担）' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  isPublic!: number
}

/** 设为公开（P4c F1/D32：生成公开链接 token；allowListing 仅文件夹有意义，默认允许列表） */
export class SetPublicLinkDto {
  @ApiPropertyOptional({ description: '允许访客浏览文件列表（仅文件夹有意义，默认 true）' })
  @IsOptional()
  @IsBoolean()
  allowListing?: boolean
}

/** 重命名 */
export class RenameDto {
  @ApiProperty({ description: '文件/文件夹 ID' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  id!: number

  @ApiProperty({ description: '新名称（≤64 字符）' })
  @IsString()
  @IsNotEmpty({ message: '名称不能为空' })
  @MaxLength(64, { message: '名称不能超过 64 字符' })
  @Length(1, 64)
  name!: string
}

/** 在线编辑保存（P4b T43，架构增补 §15.5：@MaxLength 字符级粗拦，字节级在 service 精算） */
export class UpdateContentDto {
  @ApiProperty({ description: '完整文件内容（UTF-8 文本，≤1MB）' })
  @IsString()
  @MaxLength(1_048_576, { message: '内容超出在线编辑上限（1MB）' })
  content!: string
}
