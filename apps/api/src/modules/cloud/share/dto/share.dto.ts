import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsString, Length, MaxLength, Min } from 'class-validator'

/** 分享有效期档位（D4）：1/7/30/0，0=永久 */
const EXPIRE_DAYS_OPTIONS = [1, 7, 30, 0]

/** 创建分享 */
export class ShareCreateDto {
  @ApiProperty({ description: '文件/文件夹 ID（P4d D48 起文件夹亦可分享）' })
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

  @ApiPropertyOptional({ description: '提取码（4~8 位，可选；留空 = 无密码，P4d D47）' })
  @IsOptional()
  @IsString()
  @Length(4, 8, { message: '提取码需为 4~8 位' })
  password?: string
}

/** 修改 / 移除提取码（P4d：password 为 null 表示移除密码；分享 id 走路径参数） */
export class SharePasswordDto {
  @ApiPropertyOptional({ description: '新提取码（4~8 位）；null 表示移除提取码', nullable: true })
  @IsOptional()
  @IsString()
  @Length(4, 8, { message: '提取码需为 4~8 位' })
  password?: string | null
}

/** 访客提取码校验（@Public） */
export class ShareVerifyDto {
  @ApiPropertyOptional({ description: '提取码（无密码分享可省略）' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  password?: string
}

/** 停止分享 */
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

/** 分享列表查询（status 缺省 = 排除已停止；0 已停止 / 1 有效 / 2 已过期） */
export class ShareListQueryDto {
  @ApiPropertyOptional({ description: '状态筛选（0 已停止/1 有效/2 已过期；缺省排除已停止）', enum: [0, 1, 2] })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn([0, 1, 2], { message: '状态只能为 0/1/2' })
  status?: number

  @ApiPropertyOptional({ description: '文件名关键字（模糊匹配）' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  keyword?: string
}
