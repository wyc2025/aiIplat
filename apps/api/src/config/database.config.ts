import { registerAs } from '@nestjs/config'

/** 数据库配置（Prisma 通过 schema 中的 env("DATABASE_URL") 读取，此处供业务代码取用） */
export default registerAs('database', () => ({
  url: process.env.DATABASE_URL,
}))
