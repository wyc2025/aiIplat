import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator'

/** 创建展示应用（API-P14 §21.1-1） */
export class CreateDisplayDto {
  @ApiProperty({ description: '展示应用名（属主内唯一，≤40 字）' })
  @IsString()
  @MinLength(1, { message: '展示应用名必填' })
  @MaxLength(40, { message: '展示应用名不超过 40 字' })
  name!: string

  @ApiPropertyOptional({ description: '挂靠站点 slug；缺省 = 云盘暂存区（之后可挂靠）' })
  @IsOptional()
  @IsString()
  siteSlug?: string
}

/** 挂靠 / 换挂靠 / 取消挂靠（API-P14 §21.1-3） */
export class AffiliateDisplayDto {
  @ApiPropertyOptional({
    description: '目标站点 slug；传空 = 取消挂靠回云盘暂存区',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  siteSlug?: string | null
}

/** 授权数据应用（API-P14 §21.1-5） */
export class GrantDisplayDto {
  @ApiProperty({ description: '数据应用 code（属主自服务，未发布也可先授权）' })
  @IsString()
  @MinLength(1, { message: 'appCode 必填' })
  appCode!: string
}
