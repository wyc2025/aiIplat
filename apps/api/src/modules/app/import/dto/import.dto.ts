import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsObject, IsOptional, IsString, Matches } from 'class-validator'
import { NAME_PATTERN } from '../../schema/schema.constants'

/** 导入上传查询参数（目标表） */
export class ImportQueryDto {
  @ApiProperty({ description: '目标逻辑表名' })
  @IsString()
  @Matches(NAME_PATTERN, { message: 'table 需为合法表名' })
  table!: string
}

/** 导出查询参数（目标表） */
export class ExportQueryDto {
  @ApiProperty({ description: '目标逻辑表名' })
  @IsString()
  @Matches(NAME_PATTERN, { message: 'table 需为合法表名' })
  table!: string
}

/** 确认导入：人工映射（表头 → 字段名，空串 = 忽略该列） */
export class ConfirmImportDto {
  @ApiPropertyOptional({ description: '列映射 { 表头: 字段名 }（缺省沿用自动映射）' })
  @IsOptional()
  @IsObject()
  mapping?: Record<string, string>
}
