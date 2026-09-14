import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator'
import { Transform } from 'class-transformer'

/** 调整用户配额（管理员） */
export class UpdateQuotaDto {
  /** 目标用户 ID（字符串，避免 bigint 精度问题） */
  @IsString()
  @IsNotEmpty()
  userId!: string

  /** 配额上限（字节）；下限 = 当前已用容量，不可低于已用 */
  @IsInt()
  @Min(0)
  @Transform(({ value }) => Number(value))
  quotaLimit!: number

  /** 已用容量（字节，可选）；缺省不改 used；若传值须 >= 0 */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Transform(({ value }) => Number(value))
  quotaUsed?: number
}

/** 配额对账修正（P4F T68/R61）：目标用户 ID（字符串，避免 bigint 精度问题） */
export class ReconcileUsageDto {
  @IsString()
  @IsNotEmpty()
  userId!: string
}
