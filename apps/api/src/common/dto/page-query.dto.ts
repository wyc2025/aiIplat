import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsInt, IsOptional, Max, Min } from 'class-validator'

/** 分页查询基类：页码从 1 起，pageSize 默认 10、最大 100 */
export class PageQueryDto {
  @ApiPropertyOptional({ description: '页码，从 1 起', default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  pageNo: number = 1

  @ApiPropertyOptional({ description: '每页条数，最大 100', default: 10 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  pageSize: number = 10

  /** Prisma 分页偏移量 */
  get skip(): number {
    return (this.pageNo - 1) * this.pageSize
  }

  /** Prisma 分页条数 */
  get take(): number {
    return this.pageSize
  }
}
