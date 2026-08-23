import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsOptional, IsString } from 'class-validator'
import { Type } from 'class-transformer'
import { PageQueryDto } from '../../../../common/dto/page-query.dto'

/** 登录日志查询 */
export class LoginLogQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: '用户名（模糊）' })
  @IsOptional()
  @IsString()
  username?: string

  @ApiPropertyOptional({ description: '状态 1 成功 0 失败' })
  @IsOptional()
  @Type(() => Number)
  @IsIn([0, 1])
  status?: number

  @ApiPropertyOptional({ description: '开始时间（ISO）' })
  @IsOptional()
  @IsString()
  startTime?: string

  @ApiPropertyOptional({ description: '结束时间（ISO）' })
  @IsOptional()
  @IsString()
  endTime?: string
}

/** 操作日志查询 */
export class OperationLogQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: '操作人（模糊）' })
  @IsOptional()
  @IsString()
  username?: string

  @ApiPropertyOptional({ description: '模块' })
  @IsOptional()
  @IsString()
  module?: string

  @ApiPropertyOptional({ description: '状态 1 成功 0 失败' })
  @IsOptional()
  @Type(() => Number)
  @IsIn([0, 1])
  status?: number

  @ApiPropertyOptional({ description: '开始时间（ISO）' })
  @IsOptional()
  @IsString()
  startTime?: string

  @ApiPropertyOptional({ description: '结束时间（ISO）' })
  @IsOptional()
  @IsString()
  endTime?: string
}
