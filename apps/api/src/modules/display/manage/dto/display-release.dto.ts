import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator'

/** 保存版本入参（P20 T167）：备注可选 */
export class SaveReleaseDto {
  @ApiPropertyOptional({ description: '版本备注（可选，如「首页改版前」）', maxLength: 100 })
  @IsOptional()
  @IsString({ message: '版本备注必须是一段文字' })
  @MaxLength(100, { message: '版本备注最多 100 个字' })
  label?: string
}

/** 锁定 / 解锁入参 */
export class SetReleasePinDto {
  @ApiPropertyOptional({ description: 'true = 锁定（豁免删除），false = 解锁', default: true })
  @IsBoolean({ message: '锁定状态必须是 true 或 false' })
  pinned!: boolean
}
