import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsOptional, IsString, Length } from 'class-validator'

/** 创建数据应用（API-P11 §1.1） */
export class CreateAppDto {
  @ApiProperty({ description: '应用名称（1~50 字）', example: '书单' })
  @IsString()
  @Length(1, 50, { message: '应用名称需 1~50 字' })
  name!: string

  @ApiPropertyOptional({ description: '应用描述（≤200 字）' })
  @IsOptional()
  @IsString()
  @Length(0, 200, { message: '应用描述不能超过 200 字' })
  description?: string

  @ApiPropertyOptional({
    description: "blank = 直接 active（占额度）；draft = AI 草稿（不占 active 额度，限 3 个）",
    enum: ['blank', 'draft'],
  })
  @IsOptional()
  @IsIn(['blank', 'draft'], { message: "mode 仅允许 'blank' / 'draft'" })
  mode?: 'blank' | 'draft'
}

/** 修改应用（名称/描述；全部可选，至少一项生效） */
export class UpdateAppDto {
  @ApiPropertyOptional({ description: '应用名称（1~50 字）' })
  @IsOptional()
  @IsString()
  @Length(1, 50, { message: '应用名称需 1~50 字' })
  name?: string

  @ApiPropertyOptional({ description: '应用描述（≤200 字，空串清空）' })
  @IsOptional()
  @IsString()
  @Length(0, 200, { message: '应用描述不能超过 200 字' })
  description?: string
}

/** 我的应用列表查询（不分页；?status=draft 只看草稿） */
export class ListAppQueryDto {
  @ApiPropertyOptional({ description: "按状态筛选：draft = 只看草稿", enum: ['draft', 'active'] })
  @IsOptional()
  @IsIn(['draft', 'active'], { message: "status 仅允许 'draft' / 'active'" })
  status?: 'draft' | 'active'
}
