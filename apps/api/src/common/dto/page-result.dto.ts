import type { PageQueryDto } from './page-query.dto'

/** 分页返回结构：{ list, total, pageNo, pageSize } */
export class PageResultDto<T> {
  list: T[]
  total: number
  pageNo: number
  pageSize: number

  constructor(list: T[], total: number, query: PageQueryDto) {
    this.list = list
    this.total = total
    this.pageNo = query.pageNo
    this.pageSize = query.pageSize
  }
}
