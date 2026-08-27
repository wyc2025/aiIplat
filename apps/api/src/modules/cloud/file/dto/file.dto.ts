import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsInt, IsNotEmpty, IsOptional, IsString, Length, MaxLength, Min } from 'class-validator'

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
