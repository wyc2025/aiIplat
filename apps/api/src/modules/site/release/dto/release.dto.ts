import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator'

/** 发布版本入参（P19 API §2.1；label 可选 ≤100 字，超长 40001） */
export class PublishSiteDto {
  @ApiPropertyOptional({ description: '版本备注（可选，≤100 字），如「首页改版上线」' })
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: '备注不超过 100 字' })
  label?: string
}

/** 锁定 / 解锁入参（API §2.4） */
export class PinReleaseDto {
  @ApiProperty({ description: 'true = 锁定（豁免自动清理与手动删除）/ false = 解锁' })
  @IsBoolean({ message: 'pinned 必须是布尔值' })
  pinned!: boolean
}
