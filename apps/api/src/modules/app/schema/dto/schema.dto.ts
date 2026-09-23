import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateNested,
} from 'class-validator'
import { APP_FIELD_TYPES, NAME_PATTERN } from '../schema.constants'

/** 枚举选项 */
export class EnumOptionDto {
  @ApiProperty({ description: '选项值（≤50 字）' })
  @IsString()
  @Length(1, 50, { message: '枚举选项值需 1~50 字' })
  value!: string

  @ApiProperty({ description: '选项显示名（≤50 字）' })
  @IsString()
  @Length(1, 50, { message: '枚举选项名需 1~50 字' })
  label!: string
}

/** 字段定义（建表内嵌 / 加字段共用） */
export class FieldDefDto {
  @ApiProperty({ description: '字段名（小写字母开头，字母数字下划线，≤64）', example: 'title' })
  @IsString()
  @Matches(NAME_PATTERN, { message: '字段名需小写字母开头，仅含小写字母/数字/下划线' })
  name!: string

  @ApiProperty({ description: '字段显示名（1~50 字）', example: '标题' })
  @IsString()
  @Length(1, 50, { message: '字段显示名需 1~50 字' })
  label!: string

  /**
   * 字段类型（R88 七类）。**刻意不在 DTO 层限制枚举**：白名单校验放在 SchemaService
   * （人工表单与 AI 工具同一份校验链，R94），类型非法统一 50005，避免 DTO 先拦成 40001 导致双入口口径不一致。
   */
  @ApiProperty({ description: '字段类型（R88 七类）', enum: APP_FIELD_TYPES })
  @IsString()
  @Length(1, 20, { message: '字段类型需 1~20 字符' })
  type!: string

  @ApiPropertyOptional({ description: '是否必填（1/0，默认 0）', enum: [0, 1] })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn([0, 1], { message: 'required 仅允许 0 / 1' })
  required?: number

  @ApiPropertyOptional({ description: '默认值（按字段类型校验）' })
  @IsOptional()
  default?: unknown

  @ApiPropertyOptional({ description: 'enum 选项（type=enum 必填）', type: [EnumOptionDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: '枚举至少 1 个选项' })
  @ArrayMaxSize(50, { message: '枚举选项不能超过 50 个' })
  @ValidateNested({ each: true })
  @Type(() => EnumOptionDto)
  enumOptions?: EnumOptionDto[]

  @ApiPropertyOptional({ description: 'ref 目标表名（type=ref 必填）' })
  @IsOptional()
  @IsString()
  @Matches(NAME_PATTERN, { message: 'refTable 需为合法表名' })
  refTable?: string

  @ApiPropertyOptional({ description: 'ref 是否多值（1 = n:n，经中间表；默认 0）', enum: [0, 1] })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn([0, 1], { message: 'refMultiple 仅允许 0 / 1' })
  refMultiple?: number
}

/** 建表 */
export class CreateTableDto {
  @ApiProperty({ description: '表名（小写字母开头，字母数字下划线）', example: 'book' })
  @IsString()
  @Matches(NAME_PATTERN, { message: '表名需小写字母开头，仅含小写字母/数字/下划线' })
  name!: string

  @ApiProperty({ description: '表显示名（1~50 字）', example: '书' })
  @IsString()
  @Length(1, 50, { message: '表显示名需 1~50 字' })
  label!: string

  @ApiPropertyOptional({ description: '初始字段（1~50 个）', type: [FieldDefDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50, { message: '单次最多建 50 个字段' })
  @ValidateNested({ each: true })
  @Type(() => FieldDefDto)
  fields?: FieldDefDto[]
}

/** 改表（v1 仅改 label；改名走迁移式，本期禁止） */
export class UpdateTableDto {
  @ApiProperty({ description: '表显示名（1~50 字）' })
  @IsString()
  @Length(1, 50, { message: '表显示名需 1~50 字' })
  label!: string
}

/** 加字段 */
export class CreateFieldDto extends FieldDefDto {}

/** 改字段（label/必填/默认值/枚举选项） */
export class UpdateFieldDto {
  @ApiPropertyOptional({ description: '字段显示名（1~50 字）' })
  @IsOptional()
  @IsString()
  @Length(1, 50, { message: '字段显示名需 1~50 字' })
  label?: string

  @ApiPropertyOptional({ description: '是否必填（1/0）', enum: [0, 1] })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn([0, 1], { message: 'required 仅允许 0 / 1' })
  required?: number

  @ApiPropertyOptional({ description: '默认值（按字段类型校验；null 清空）', nullable: true })
  @IsOptional()
  default?: unknown

  @ApiPropertyOptional({ description: 'enum 选项（type=enum 时有效）', type: [EnumOptionDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: '枚举至少 1 个选项' })
  @ArrayMaxSize(50, { message: '枚举选项不能超过 50 个' })
  @ValidateNested({ each: true })
  @Type(() => EnumOptionDto)
  enumOptions?: EnumOptionDto[]
}

/** 类型收窄（text→enum / number→enum；先跑存量校验，不合规 50003） */
export class ShrinkFieldDto {
  @ApiProperty({ description: '目标类型（本期仅 enum）', enum: ['enum'] })
  @IsIn(['enum'], { message: '类型收窄本期仅支持 text/number → enum' })
  type!: 'enum'

  @ApiProperty({ description: 'enum 选项', type: [EnumOptionDto] })
  @IsArray()
  @ArrayMinSize(1, { message: '枚举至少 1 个选项' })
  @ArrayMaxSize(50, { message: '枚举选项不能超过 50 个' })
  @ValidateNested({ each: true })
  @Type(() => EnumOptionDto)
  enumOptions!: EnumOptionDto[]
}

/** 建 n:n 关系（自动生成中间表；幂等） */
export class CreateRelationDto {
  @ApiProperty({ description: '源表名', example: 'article' })
  @IsString()
  @Matches(NAME_PATTERN, { message: 'fromTable 需为合法表名' })
  fromTable!: string

  @ApiProperty({ description: '源表上的 ref 字段名（不存在则自动创建为多值 ref）', example: 'tag_ids' })
  @IsString()
  @Matches(NAME_PATTERN, { message: 'fromField 需为合法字段名' })
  fromField!: string

  @ApiProperty({ description: '目标表名', example: 'tag' })
  @IsString()
  @Matches(NAME_PATTERN, { message: 'toTable 需为合法表名' })
  toTable!: string
}
