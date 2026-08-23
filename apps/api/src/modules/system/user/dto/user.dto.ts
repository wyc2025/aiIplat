import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
} from 'class-validator'
import { PageQueryDto } from '../../../../common/dto/page-query.dto'

/** 密码策略：8~32 位，必须含字母和数字（PRD 6.6） */
export const PASSWORD_REGEX = /^(?=.*[A-Za-z])(?=.*\d)[\S]{8,32}$/
export const PASSWORD_MESSAGE = '密码需 8~32 位，且同时包含字母和数字'

/** 用户分页查询 */
export class UserQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: '用户名（模糊）' })
  @IsOptional()
  @IsString()
  username?: string

  @ApiPropertyOptional({ description: '手机号' })
  @IsOptional()
  @IsString()
  phone?: string

  @ApiPropertyOptional({ description: '状态 1 启用 0 禁用' })
  @IsOptional()
  @Type(() => Number)
  @IsIn([0, 1])
  status?: number
}

/** 新增用户 */
export class CreateUserDto {
  @ApiProperty({ description: '登录名' })
  @IsString()
  @IsNotEmpty({ message: '用户名不能为空' })
  @Length(2, 50, { message: '用户名需 2~50 位' })
  username!: string

  @ApiProperty({ description: '初始密码（8~32 位含字母数字）' })
  @IsString()
  @Matches(PASSWORD_REGEX, { message: PASSWORD_MESSAGE })
  password!: string

  @ApiProperty({ description: '昵称' })
  @IsString()
  @IsNotEmpty({ message: '昵称不能为空' })
  @Length(1, 50)
  nickname!: string

  @ApiPropertyOptional({ description: '邮箱' })
  @IsOptional()
  @IsEmail({}, { message: '邮箱格式不正确' })
  email?: string

  @ApiPropertyOptional({ description: '手机号' })
  @IsOptional()
  @Matches(/^1\d{10}$/, { message: '手机号格式不正确' })
  phone?: string

  @ApiPropertyOptional({ description: '性别 0 未知 1 男 2 女', default: 0 })
  @IsOptional()
  @IsIn([0, 1, 2])
  gender: number = 0

  @ApiPropertyOptional({ description: '部门 ID' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  deptId?: number

  @ApiPropertyOptional({ description: '状态 1 启用 0 禁用', default: 1 })
  @IsOptional()
  @IsIn([0, 1])
  status: number = 1

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional()
  @IsString()
  @Length(0, 255)
  remark?: string

  @ApiPropertyOptional({ description: '角色 ID 列表', type: [Number] })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Type(() => Number)
  roleIds?: number[]
}

/** 编辑用户（不含用户名/密码，另有重置密码接口） */
export class UpdateUserDto {
  @ApiPropertyOptional({ description: '昵称' })
  @IsOptional()
  @IsString()
  @Length(1, 50)
  nickname?: string

  @ApiPropertyOptional({ description: '邮箱' })
  @IsOptional()
  @IsEmail({}, { message: '邮箱格式不正确' })
  email?: string

  @ApiPropertyOptional({ description: '手机号' })
  @IsOptional()
  @Matches(/^1\d{10}$/, { message: '手机号格式不正确' })
  phone?: string

  @ApiPropertyOptional({ description: '性别 0 未知 1 男 2 女' })
  @IsOptional()
  @IsIn([0, 1, 2])
  gender?: number

  @ApiPropertyOptional({ description: '部门 ID' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  deptId?: number

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional()
  @IsString()
  @Length(0, 255)
  remark?: string
}

/** 启禁用 */
export class UpdateStatusDto {
  @ApiProperty({ description: '状态 1 启用 0 禁用' })
  @IsIn([0, 1])
  status!: number
}

/** 分配角色 */
export class AssignRoleDto {
  @ApiProperty({ description: '角色 ID 列表', type: [Number] })
  @IsArray()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Type(() => Number)
  roleIds!: number[]
}
