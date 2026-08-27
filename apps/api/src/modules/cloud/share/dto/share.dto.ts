import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, Min } from 'class-validator'

/** 分享有效期档位（D4）：1/7/30/0，0=永久 */
const EXPIRE_DAYS_OPTIONS = [1, 7, 30, 0]

/** 创建分享 */
export class ShareCreateDto {
  @ApiProperty({ description: '文件 ID（仅文件可分享，30009）' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  fileId!: number

  @ApiPropertyOptional({ description: '有效期天数（1/7/30/0，0=永久，缺省 7）', default: 7 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn(EXPIRE_DAYS_OPTIONS, { message: '有效期天数只能为 1/7/30/0' })
  expireDays?: number = 7
}

/** 停止公开 */
export class ShareStopDto {
  @ApiProperty({ description: '分享记录 ID' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  id!: number
}

/** 延长时间 */
export class ShareExtendDto {
  @ApiProperty({ description: '分享记录 ID' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  id!: number

  @ApiProperty({ description: '续期天数（1/7/30/0，0=永久）' })
  @Type(() => Number)
  @IsInt()
  @IsIn(EXPIRE_DAYS_OPTIONS, { message: '有效期天数只能为 1/7/30/0' })
  expireDays!: number
}
