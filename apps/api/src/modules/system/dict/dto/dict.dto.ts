import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Length, Matches, Min } from 'class-validator'
import { PageQueryDto } from '../../../../common/dto/page-query.dto'

// ========== 字典类型 ==========

export class DictTypeQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: '类型名称（模糊）' })
  @IsOptional()
  @IsString()
  name?: string
}

export class CreateDictTypeDto {
  @ApiProperty({ description: '类型名称' })
  @IsString()
  @IsNotEmpty({ message: '类型名称不能为空' })
  @Length(1, 50)
  name!: string

  @ApiProperty({ description: '类型标识（如 sys_common_status，小写字母/数字/下划线）' })
  @IsString()
  @IsNotEmpty({ message: '类型标识不能为空' })
  @Matches(/^[a-z0-9_]+$/, { message: '类型标识仅支持小写字母、数字、下划线' })
  @Length(1, 100)
  type!: string

  @ApiPropertyOptional({ description: '状态 1 启用 0 禁用', default: 1 })
  @IsOptional()
  @IsIn([0, 1])
  status: number = 1

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional()
  @IsString()
  @Length(0, 255)
  remark?: string
}

export class UpdateDictTypeDto {
  @ApiPropertyOptional({ description: '类型名称' })
  @IsOptional()
  @IsString()
  @Length(1, 50)
  name?: string

  @ApiPropertyOptional({ description: '状态 1 启用 0 禁用' })
  @IsOptional()
  @IsIn([0, 1])
  status?: number

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional()
  @IsString()
  @Length(0, 255)
  remark?: string
}

// ========== 字典数据 ==========

export class CreateDictDataDto {
  @ApiProperty({ description: '字典类型 ID' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  typeId!: number

  @ApiProperty({ description: '标签' })
  @IsString()
  @IsNotEmpty({ message: '标签不能为空' })
  @Length(1, 50)
  label!: string

  @ApiProperty({ description: '值' })
  @IsString()
  @IsNotEmpty({ message: '值不能为空' })
  @Length(1, 50)
  value!: string

  @ApiPropertyOptional({ description: '排序', default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sort: number = 0

  @ApiPropertyOptional({ description: '状态 1 启用 0 禁用', default: 1 })
  @IsOptional()
  @IsIn([0, 1])
  status: number = 1

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional()
  @IsString()
  @Length(0, 255)
  remark?: string
}

export class UpdateDictDataDto {
  @ApiPropertyOptional({ description: '标签' })
  @IsOptional()
  @IsString()
  @Length(1, 50)
  label?: string

  @ApiPropertyOptional({ description: '值' })
  @IsOptional()
  @IsString()
  @Length(1, 50)
  value?: string

  @ApiPropertyOptional({ description: '排序' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sort?: number

  @ApiPropertyOptional({ description: '状态 1 启用 0 禁用' })
  @IsOptional()
  @IsIn([0, 1])
  status?: number

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional()
  @IsString()
  @Length(0, 255)
  remark?: string
}
