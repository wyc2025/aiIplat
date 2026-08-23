import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { ArrayNotEmpty, IsArray, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Length, Matches, Min } from 'class-validator'
import { PageQueryDto } from '../../../../common/dto/page-query.dto'

/** 角色分页查询 */
export class RoleQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: '角色名（模糊）' })
  @IsOptional()
  @IsString()
  name?: string

  @ApiPropertyOptional({ description: '状态 1 启用 0 禁用' })
  @IsOptional()
  @Type(() => Number)
  @IsIn([0, 1])
  status?: number
}

/** 新增角色 */
export class CreateRoleDto {
  @ApiProperty({ description: '角色名' })
  @IsString()
  @IsNotEmpty({ message: '角色名不能为空' })
  @Length(1, 50)
  name!: string

  @ApiProperty({ description: '角色标识（小写字母/数字/下划线/中划线）' })
  @IsString()
  @IsNotEmpty({ message: '角色标识不能为空' })
  @Matches(/^[a-z0-9_-]+$/, { message: '角色标识仅支持小写字母、数字、下划线、中划线' })
  @Length(1, 50)
  code!: string

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

/** 编辑角色 */
export class UpdateRoleDto {
  @ApiPropertyOptional({ description: '角色名' })
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

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional()
  @IsString()
  @Length(0, 255)
  remark?: string
}

/** 分配菜单权限 */
export class AssignMenuDto {
  @ApiProperty({ description: '菜单 ID 列表', type: [Number] })
  @IsArray()
  @ArrayNotEmpty({ message: '菜单列表不能为空' })
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Type(() => Number)
  menuIds!: number[]
}
