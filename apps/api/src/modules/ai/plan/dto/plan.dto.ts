import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Length, Matches, Min } from 'class-validator'
import { PageQueryDto } from '../../../../common/dto/page-query.dto'

// ========== 管理端套餐 CRUD ==========

export class CreatePlanDto {
  @ApiProperty({ description: '套餐名称' })
  @IsString()
  @IsNotEmpty({ message: '套餐名称不能为空' })
  @Length(1, 50)
  name!: string

  @ApiProperty({ description: '套餐标识（小写字母/数字/下划线/中划线）' })
  @IsString()
  @IsNotEmpty({ message: '套餐标识不能为空' })
  @Matches(/^[a-z0-9_-]+$/, { message: '套餐标识仅支持小写字母、数字、下划线、中划线' })
  @Length(1, 50)
  code!: string

  @ApiProperty({ description: '每月积分额度' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  monthlyCredits!: number

  @ApiPropertyOptional({ description: '价格（展示用，本期无真实支付）', default: 0 })
  @IsOptional()
  @Type(() => Number)
  price: number = 0

  @ApiPropertyOptional({ description: '说明' })
  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string

  @ApiPropertyOptional({ description: '状态 1 启用 0 禁用', default: 1 })
  @IsOptional()
  @IsIn([0, 1])
  status: number = 1

  @ApiPropertyOptional({ description: '排序', default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sort: number = 0
}

export class UpdatePlanDto {
  @ApiPropertyOptional({ description: '套餐名称' })
  @IsOptional()
  @IsString()
  @Length(1, 50)
  name?: string

  @ApiPropertyOptional({ description: '每月积分额度' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  monthlyCredits?: number

  @ApiPropertyOptional({ description: '价格' })
  @IsOptional()
  @Type(() => Number)
  price?: number

  @ApiPropertyOptional({ description: '说明' })
  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string

  @ApiPropertyOptional({ description: '状态 1 启用 0 禁用' })
  @IsOptional()
  @IsIn([0, 1])
  status?: number

  @ApiPropertyOptional({ description: '排序' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sort?: number
}

// ========== 用户侧开通/切换 ==========

export class SubscribePlanDto {
  @ApiProperty({ description: '套餐 ID' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  planId!: number
}

// ========== 管理端指派 ==========

export class AssignPlanDto {
  @ApiProperty({ description: '用户 ID' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  userId!: number

  @ApiProperty({ description: '套餐 ID' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  planId!: number
}

/** 套餐分页查询（管理端） */
export class PlanQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: '套餐名称（模糊）' })
  @IsOptional()
  @IsString()
  name?: string
}
