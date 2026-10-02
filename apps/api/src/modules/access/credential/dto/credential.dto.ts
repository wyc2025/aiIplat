import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayNotEmpty,
  IsArray,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator'

/** 凭证 scope 入参（R133；P17 启用第四纵深 rowFilter）：tables 必填非空；fields / rowFilter 可选 */
export class CredentialScopeDto {
  @ApiProperty({ description: '可读表名清单（至少 1 张；须为已暴露的表）', type: [String] })
  @IsArray({ message: 'scope.tables 必须是数组' })
  @ArrayNotEmpty({ message: 'scope.tables 至少需要 1 张表' })
  @IsString({ each: true, message: 'scope.tables 元素必须是表名' })
  tables!: string[]

  @ApiPropertyOptional({
    description: '字段级收窄 {表名: [字段名…]}；缺省 = 该表全部已暴露字段',
    type: Object,
  })
  @IsOptional()
  @IsObject({ message: 'scope.fields 必须是对象' })
  fields?: Record<string, string[]>

  @ApiPropertyOptional({
    description:
      '行级过滤 {表名: ["字段:op:值", …]}（P17 第四纵深）；缺省 = 不过滤。' +
      '条件与请求 filter 同语法（op 取 eq / contains），每表至多 3 条、多条为「且」的关系',
    type: Object,
  })
  @IsOptional()
  @IsObject({ message: 'scope.rowFilter 必须是对象' })
  rowFilter?: Record<string, string[]> | null
}

/** 创建凭证（API-P15 §1-1） */
export class CreateCredentialDto {
  @ApiProperty({ description: '数据应用 code（自己名下、未软删）' })
  @IsString()
  @Length(1, 50, { message: 'appCode 长度须在 1~50 之间' })
  appCode!: string

  @ApiProperty({ description: '备注名（如「ERP 对接」）' })
  @IsString()
  @Length(1, 64, { message: '备注名长度须在 1~64 之间' })
  name!: string

  @ApiProperty({ description: '授权范围（表 + 可选字段）', type: CredentialScopeDto })
  @ValidateNested()
  @Type(() => CredentialScopeDto)
  scope!: CredentialScopeDto

  @ApiPropertyOptional({ description: '过期时间（ISO 8601）；缺省 = 不过期' })
  @IsOptional()
  @IsISO8601({}, { message: 'expiresAt 必须是 ISO 8601 时间字符串' })
  expiresAt?: string
}

/** 编辑凭证（API-P15 §1-4；仅改备注名 / scope / 过期时间，密钥不可改） */
export class UpdateCredentialDto {
  @ApiPropertyOptional({ description: '备注名' })
  @IsOptional()
  @IsString()
  @Length(1, 64, { message: '备注名长度须在 1~64 之间' })
  name?: string

  @ApiPropertyOptional({ description: '授权范围（校验同创建）', type: CredentialScopeDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CredentialScopeDto)
  scope?: CredentialScopeDto

  @ApiPropertyOptional({ description: '过期时间（ISO 8601；传 null = 取消过期）', nullable: true })
  @IsOptional()
  @IsISO8601({}, { message: 'expiresAt 必须是 ISO 8601 时间字符串' })
  expiresAt?: string | null
}
