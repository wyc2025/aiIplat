import { ApiProperty } from '@nestjs/swagger'
import { ArrayMaxSize, ArrayNotEmpty, IsArray, Matches } from 'class-validator'

/** 打包下载入参（P4d T54：文件/文件夹混合，1~100 项；id 为字符串形式的大整数） */
export class PackDownloadDto {
  @ApiProperty({ description: '要打包的项 ID 列表（文件/文件夹混合，1~100 项）', type: [String] })
  @IsArray()
  @ArrayNotEmpty({ message: '请至少选择一项' })
  @ArrayMaxSize(100, { message: '单次最多打包 100 项' })
  @Matches(/^\d+$/, { each: true, message: 'ID 格式非法' })
  ids!: string[]
}
