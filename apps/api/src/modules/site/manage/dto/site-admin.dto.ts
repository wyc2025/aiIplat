import { ApiProperty } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsInt, IsNotEmpty, IsString, Matches, Min } from 'class-validator'

/** 站点配额查询（admin，API-P4E §10.4） */
export class SiteQuotaQueryDto {
  @ApiProperty({ description: '目标用户 ID（字符串，避免 bigint 精度问题）' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d+$/, { message: '用户 ID 非法' })
  userId!: string
}

/** 调整用户站点配额（admin，API-P4E §10.4；下限 = 该用户当前站点数） */
export class UpdateSiteQuotaDto {
  @ApiProperty({ description: '目标用户 ID（字符串，避免 bigint 精度问题）' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d+$/, { message: '用户 ID 非法' })
  userId!: string

  @ApiProperty({ description: '站点数上限（整数；下限 = 该用户当前站点数，低于下限 400）' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  limit!: number
}
