import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsInt, IsOptional, IsString, Min } from 'class-validator'
import { PageQueryDto } from '../../../../common/dto/page-query.dto'

/** 我的用量查询（分页 + 模型筛选） */
export class MyUsageQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: '模型 ID 筛选' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  modelId?: number
}

/** 管理端用量查询（用户名模糊 + 模型 + 时间范围） */
export class AdminUsageQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: '用户名（模糊）' })
  @IsOptional()
  @IsString()
  username?: string

  @ApiPropertyOptional({ description: '模型 ID 筛选' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  modelId?: number

  @ApiPropertyOptional({ description: '开始时间（ISO 8601）' })
  @IsOptional()
  @IsString()
  startTime?: string

  @ApiPropertyOptional({ description: '结束时间（ISO 8601）' })
  @IsOptional()
  @IsString()
  endTime?: string
}
