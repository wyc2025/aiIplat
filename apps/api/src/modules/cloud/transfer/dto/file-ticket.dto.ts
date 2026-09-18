import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsOptional, IsString, Matches } from 'class-validator'

/**
 * 票据直链查询参数（@Public 端点 `GET /cloud/file/stream/:id`）。
 * 票据即身份：由登录态端点签发，签名覆盖 uid + exp（见 transfer/file-ticket.ts），
 * 故这里的 uid 不是授权来源，仅参与签名重算。
 */
export class FileStreamQueryDto {
  @ApiProperty({ description: '票据签名（base64url，HMAC-SHA256）' })
  @IsString()
  ticket!: string

  @ApiProperty({ description: '票据归属用户 ID（签名已覆盖）' })
  @Matches(/^\d+$/, { message: 'uid 非法' })
  uid!: string

  @ApiProperty({ description: '过期时间戳（毫秒）' })
  @Matches(/^\d+$/, { message: 'exp 非法' })
  exp!: string

  @ApiPropertyOptional({
    description: 'inline = 预览（默认）；attachment = 下载（触发浏览器原生下载）',
    enum: ['inline', 'attachment'],
  })
  @IsOptional()
  @IsIn(['inline', 'attachment'])
  mode?: 'inline' | 'attachment'
}
