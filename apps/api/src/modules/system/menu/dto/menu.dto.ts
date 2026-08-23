import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Length, Min, ValidateIf } from 'class-validator'

/** 新增菜单 */
export class CreateMenuDto {
  @ApiProperty({ description: '父菜单 ID，0 为根' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  parentId!: number

  @ApiProperty({ description: '显示名' })
  @IsString()
  @IsNotEmpty({ message: '菜单名称不能为空' })
  @Length(1, 50)
  name!: string

  @ApiProperty({ description: '类型 1 目录 2 菜单 3 按钮' })
  @IsIn([1, 2, 3], { message: '类型仅支持 1 目录 / 2 菜单 / 3 按钮' })
  type!: number

  @ApiPropertyOptional({ description: '路由地址（目录/菜单）' })
  @IsOptional()
  @IsString()
  @Length(0, 200)
  path?: string

  @ApiPropertyOptional({ description: '前端组件路径（菜单）' })
  @IsOptional()
  @IsString()
  @Length(0, 200)
  component?: string

  @ApiPropertyOptional({ description: '权限标识（按钮必填，如 system:user:create）' })
  @ValidateIf((o: CreateMenuDto) => o.type === 3)
  @IsNotEmpty({ message: '按钮类型必须填写权限标识' })
  @IsOptional()
  @IsString()
  @Length(0, 100)
  perms?: string

  @ApiPropertyOptional({ description: '图标名' })
  @IsOptional()
  @IsString()
  @Length(0, 50)
  icon?: string

  @ApiPropertyOptional({ description: '排序', default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sort: number = 0

  @ApiPropertyOptional({ description: '是否显示 1 显示 0 隐藏', default: 1 })
  @IsOptional()
  @IsIn([0, 1])
  visible: number = 1

  @ApiPropertyOptional({ description: '状态 1 启用 0 禁用', default: 1 })
  @IsOptional()
  @IsIn([0, 1])
  status: number = 1
}

/** 编辑菜单 */
export class UpdateMenuDto {
  @ApiPropertyOptional({ description: '父菜单 ID' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  parentId?: number

  @ApiPropertyOptional({ description: '显示名' })
  @IsOptional()
  @IsString()
  @Length(1, 50)
  name?: string

  @ApiPropertyOptional({ description: '类型 1 目录 2 菜单 3 按钮' })
  @IsOptional()
  @IsIn([1, 2, 3])
  type?: number

  @ApiPropertyOptional({ description: '路由地址' })
  @IsOptional()
  @IsString()
  @Length(0, 200)
  path?: string

  @ApiPropertyOptional({ description: '前端组件路径' })
  @IsOptional()
  @IsString()
  @Length(0, 200)
  component?: string

  @ApiPropertyOptional({ description: '权限标识' })
  @IsOptional()
  @IsString()
  @Length(0, 100)
  perms?: string

  @ApiPropertyOptional({ description: '图标名' })
  @IsOptional()
  @IsString()
  @Length(0, 50)
  icon?: string

  @ApiPropertyOptional({ description: '排序' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sort?: number

  @ApiPropertyOptional({ description: '是否显示 1 显示 0 隐藏' })
  @IsOptional()
  @IsIn([0, 1])
  visible?: number

  @ApiPropertyOptional({ description: '状态 1 启用 0 禁用' })
  @IsOptional()
  @IsIn([0, 1])
  status?: number
}
