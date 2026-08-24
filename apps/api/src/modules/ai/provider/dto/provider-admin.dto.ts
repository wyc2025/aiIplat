import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Length, Matches, Min } from 'class-validator'
import { PageQueryDto } from '../../../../common/dto/page-query.dto'

// ========== 厂商管理 ==========

export class CreateProviderDto {
  @ApiProperty({ description: '厂商显示名，如 DeepSeek' })
  @IsString()
  @IsNotEmpty({ message: '厂商名称不能为空' })
  @Length(1, 50)
  name!: string

  @ApiProperty({ description: '厂商标识（小写字母/数字/下划线/中划线）' })
  @IsString()
  @IsNotEmpty({ message: '厂商标识不能为空' })
  @Matches(/^[a-z0-9_-]+$/, { message: '厂商标识仅支持小写字母、数字、下划线、中划线' })
  @Length(1, 30)
  code!: string

  @ApiProperty({ description: 'OpenAI 兼容端点' })
  @IsString()
  @IsNotEmpty({ message: 'Base URL 不能为空' })
  @Length(1, 200)
  baseUrl!: string

  @ApiPropertyOptional({ description: 'API Key' })
  @IsOptional()
  @IsString()
  @Length(0, 255)
  apiKey?: string

  @ApiPropertyOptional({ description: '状态 1 启用 0 禁用', default: 1 })
  @IsOptional()
  @IsIn([0, 1])
  status: number = 1

  @ApiPropertyOptional({ description: '排序', default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sort: number = 0

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional()
  @IsString()
  @Length(0, 255)
  remark?: string
}

export class UpdateProviderDto {
  @ApiPropertyOptional({ description: '厂商显示名' })
  @IsOptional()
  @IsString()
  @Length(1, 50)
  name?: string

  @ApiPropertyOptional({ description: 'OpenAI 兼容端点' })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  baseUrl?: string

  @ApiPropertyOptional({ description: 'API Key（传空串表示不修改）' })
  @IsOptional()
  @IsString()
  @Length(0, 255)
  apiKey?: string

  @ApiPropertyOptional({ description: '状态 1 启用 0 禁用' })
  @IsOptional()
  @IsIn([0, 1])
  status?: number

  @ApiPropertyOptional({ description: '排序' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sort?: number

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional()
  @IsString()
  @Length(0, 255)
  remark?: string
}

/** 厂商分页查询 */
export class ProviderQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: '厂商名称（模糊）' })
  @IsOptional()
  @IsString()
  name?: string
}

// ========== 模型管理 ==========

export class CreateModelDto {
  @ApiProperty({ description: '所属厂商 ID' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  providerId!: number

  @ApiProperty({ description: '模型显示名，如 DeepSeek Chat' })
  @IsString()
  @IsNotEmpty({ message: '显示名不能为空' })
  @Length(1, 50)
  displayName!: string

  @ApiProperty({ description: 'API 模型名，如 deepseek-chat' })
  @IsString()
  @IsNotEmpty({ message: 'API 模型名不能为空' })
  @Length(1, 100)
  model!: string

  @ApiProperty({ description: '输入单价（积分/千 tokens）' })
  @Type(() => Number)
  @Min(0)
  inputPrice!: number

  @ApiProperty({ description: '输出单价（积分/千 tokens）' })
  @Type(() => Number)
  @Min(0)
  outputPrice!: number

  @ApiProperty({ description: '上下文长度（tokens）' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxContext!: number

  @ApiPropertyOptional({ description: '是否支持工具调用 1/0', default: 0 })
  @IsOptional()
  @IsIn([0, 1])
  supportTool: number = 0

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

export class UpdateModelDto {
  @ApiPropertyOptional({ description: '显示名' })
  @IsOptional()
  @IsString()
  @Length(1, 50)
  displayName?: string

  @ApiPropertyOptional({ description: '输入单价' })
  @IsOptional()
  @Type(() => Number)
  @Min(0)
  inputPrice?: number

  @ApiPropertyOptional({ description: '输出单价' })
  @IsOptional()
  @Type(() => Number)
  @Min(0)
  outputPrice?: number

  @ApiPropertyOptional({ description: '上下文长度' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxContext?: number

  @ApiPropertyOptional({ description: '是否支持工具调用 1/0' })
  @IsOptional()
  @IsIn([0, 1])
  supportTool?: number

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

/** 模型列表查询（按厂商，不分页） */
export class ModelQueryDto {
  @ApiProperty({ description: '所属厂商 ID' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  providerId!: number
}
