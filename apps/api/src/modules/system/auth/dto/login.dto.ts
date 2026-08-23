import { ApiProperty } from '@nestjs/swagger'
import { IsNotEmpty, IsString, Length } from 'class-validator'

/** 登录入参 */
export class LoginDto {
  @ApiProperty({ description: '登录名', example: 'admin' })
  @IsString()
  @IsNotEmpty({ message: '用户名不能为空' })
  @Length(1, 50)
  username!: string

  @ApiProperty({ description: '密码', example: 'Admin@123' })
  @IsString()
  @IsNotEmpty({ message: '密码不能为空' })
  @Length(1, 100)
  password!: string
}

/** 登录 / 刷新出参 */
export class TokenPairDto {
  @ApiProperty({ description: '访问令牌（2h）' })
  accessToken!: string

  @ApiProperty({ description: '刷新令牌（7d）' })
  refreshToken!: string

  @ApiProperty({ description: '访问令牌有效期（秒）', example: 7200 })
  expiresIn!: number
}
