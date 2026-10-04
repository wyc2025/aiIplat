import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator'

/** 发布版本入参（P19 API §2.1；label 可选 ≤100 字，超长 40001） */
export class PublishSiteDto {
  @ApiPropertyOptional({ description: '版本备注（可选，≤100 字），如「首页改版上线」' })
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: '备注不超过 100 字' })
  label?: string

  @ApiPropertyOptional({
    description:
      '只发布这一个展示页（可选）：以站点当前版本为蓝本，仅替换该展示页的内容，' +
      '线上其它内容原样不动。站点从未发布过 → 40001（没有蓝本可用）',
  })
  @IsOptional()
  @IsString()
  onlyDisplayId?: string

  /** 兼容别名：部分界面把参数写成 `displayId` */
  @ApiPropertyOptional({ description: '同 `onlyDisplayId`', deprecated: true })
  @IsOptional()
  @IsString()
  displayId?: string
}

/** 锁定 / 解锁入参（API §2.4） */
export class PinReleaseDto {
  @ApiProperty({ description: 'true = 锁定（豁免自动清理与手动删除）/ false = 解锁' })
  @IsBoolean({ message: 'pinned 必须是布尔值' })
  pinned!: boolean
}
