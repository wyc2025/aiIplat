import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsISO8601, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator'

/** 审计检索入参（API-P15 §3.5；pageSize ≤50） */
export class AuditQueryDto {
  @ApiPropertyOptional({ description: '按凭证 id 过滤（principal = cred:{id}）' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{1,20}$/, { message: 'credentialId 必须是数字 id' })
  credentialId?: string

  @ApiPropertyOptional({ description: '起始时间（ISO 8601，含）' })
  @IsOptional()
  @IsISO8601({}, { message: 'from 必须是 ISO 8601 时间字符串' })
  from?: string

  @ApiPropertyOptional({ description: '结束时间（ISO 8601，含）' })
  @IsOptional()
  @IsISO8601({}, { message: 'to 必须是 ISO 8601 时间字符串' })
  to?: string

  @ApiPropertyOptional({ description: '结果码过滤（0 / 40001 / 40400 / 42900 / 50019 …）' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'resultCode 必须是整数' })
  resultCode?: number

  @ApiPropertyOptional({ description: '页码（默认 1）' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageNo?: number

  @ApiPropertyOptional({ description: '每页条数（默认 20，≤50）' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50, { message: 'pageSize 不能超过 50' })
  pageSize?: number
}
