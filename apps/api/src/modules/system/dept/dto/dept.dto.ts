import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Length, Min } from 'class-validator'
import { Type } from 'class-transformer'

/** 新增部门 */
export class CreateDeptDto {
  @ApiProperty({ description: '父部门 ID，0 为根' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  parentId!: number

  @ApiProperty({ description: '部门名称' })
  @IsString()
  @IsNotEmpty({ message: '部门名称不能为空' })
  @Length(1, 50)
  name!: string

  @ApiPropertyOptional({ description: '排序', default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sort: number = 0

  @ApiPropertyOptional({ description: '状态 1 启用 0 禁用', default: 1 })
  @IsOptional()
  @IsIn([0, 1])
  status: number = 1
}

/** 编辑部门（全部可选） */
export class UpdateDeptDto {
  @ApiPropertyOptional({ description: '父部门 ID' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  parentId?: number

  @ApiPropertyOptional({ description: '部门名称' })
  @IsOptional()
  @IsString()
  @Length(1, 50)
  name?: string

  @ApiPropertyOptional({ description: '排序' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sort?: number

  @ApiPropertyOptional({ description: '状态 1 启用 0 禁用' })
  @IsOptional()
  @IsIn([0, 1])
  status?: number
}
