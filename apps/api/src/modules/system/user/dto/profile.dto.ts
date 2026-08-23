import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, Length, Matches } from 'class-validator'
import { PASSWORD_MESSAGE, PASSWORD_REGEX } from './user.dto'

/** 个人中心：修改自己的基本信息（不含用户名/密码/角色/部门） */
export class UpdateProfileDto {
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

  @ApiPropertyOptional({ description: '性别 0 未知 1 男 2 女' })
  @IsOptional()
  @IsIn([0, 1, 2])
  gender?: number
}

/** 个人中心：修改密码（成功后全部会话失效，强制重新登录） */
export class ChangePasswordDto {
  @ApiProperty({ description: '旧密码' })
  @IsString()
  @IsNotEmpty({ message: '旧密码不能为空' })
  oldPassword!: string

  @ApiProperty({ description: '新密码（8~32 位含字母数字）' })
  @IsString()
  @Matches(PASSWORD_REGEX, { message: PASSWORD_MESSAGE })
  newPassword!: string
}
