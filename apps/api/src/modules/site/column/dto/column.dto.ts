import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsInt, IsOptional, IsString, Length, Min } from 'class-validator'

/** 创建栏目（R6：≤3 级，层级校验在 Service；同级同名不去重） */
export class CreateColumnDto {
  @ApiPropertyOptional({ description: '父栏目 ID（0 = 根，缺省 0）', default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  parentId: number = 0

  @ApiProperty({ description: '栏目名称（1~32 字）' })
  @IsString()
  @Length(1, 32, { message: '栏目名称需 1~32 字' })
  name!: string

  @ApiPropertyOptional({ description: '同级排序值（升序，缺省 0）', default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sort: number = 0
}

/** 编辑栏目（name/sort/parentId 均可选；换父级禁止指向自身或后代且不得超 3 级） */
export class UpdateColumnDto {
  @ApiPropertyOptional({ description: '栏目名称（1~32 字）' })
  @IsOptional()
  @IsString()
  @Length(1, 32, { message: '栏目名称需 1~32 字' })
  name?: string

  @ApiPropertyOptional({ description: '同级排序值（升序）' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sort?: number

  @ApiPropertyOptional({ description: '新父栏目 ID（0 = 移到根）' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  parentId?: number
}
