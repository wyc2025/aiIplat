import { ApiProperty } from '@nestjs/swagger'
import { IsNotEmpty, IsString } from 'class-validator'

/** 刷新 token 入参 */
export class RefreshDto {
  @ApiProperty({ description: '刷新令牌' })
  @IsString()
  @IsNotEmpty({ message: 'refreshToken 不能为空' })
  refreshToken!: string
}
