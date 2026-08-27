import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsInt, IsOptional, Min } from 'class-validator'

/** 上传目标目录 */
export class UploadQueryDto {
  @ApiPropertyOptional({ description: '目标目录 ID，缺省 0=根目录', default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  parentId: number = 0
}
