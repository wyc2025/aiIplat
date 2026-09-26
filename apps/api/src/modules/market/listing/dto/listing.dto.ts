import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsBoolean, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator'
import { APP_CODE_PATTERN } from '../../snapshot/snapshot'

/** 提交市场（POST /api/market/submissions，API §20.1） */
export class SubmitListingDto {
  @ApiProperty({ description: '应用 code（属主自服务）', example: 'shufage' })
  @IsString()
  @Matches(APP_CODE_PATTERN, { message: 'appCode 需为合法应用标识' })
  appCode!: string

  @ApiPropertyOptional({ description: '是否附带演示数据（≤100 行/表，附件字段置 null）' })
  @IsOptional()
  @IsBoolean({ message: 'withDemoData 仅允许布尔值' })
  withDemoData?: boolean
}

/** 市场浏览列表查询（GET /api/market/list） */
export class ListMarketQueryDto {
  @ApiPropertyOptional({ description: '页码（默认 1）' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number

  @ApiPropertyOptional({ description: '每页条数（默认 12，上限 50）' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50, { message: 'pageSize 不得超过 50' })
  pageSize?: number
}
