import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { configLoaders } from './config'
import { validateEnv } from './config/validate'
import { GlobalExceptionFilter } from './gateway/filters/global-exception.filter'
import { JwtAuthGuard } from './gateway/guards/jwt-auth.guard'
import { JwtStrategy } from './gateway/guards/jwt.strategy'
import { PermissionGuard } from './gateway/guards/permission.guard'
import { OperationLogInterceptor } from './gateway/interceptors/operation-log.interceptor'
import { TransformInterceptor } from './gateway/interceptors/transform.interceptor'
import { PrismaModule } from './infra/prisma/prisma.module'
import { RedisModule } from './infra/redis/redis.module'
import { AuthModule } from './modules/system/auth/auth.module'
import { DashboardModule } from './modules/system/dashboard/dashboard.module'
import { DeptModule } from './modules/system/dept/dept.module'
import { DictModule } from './modules/system/dict/dict.module'
import { LogModule } from './modules/system/log/log.module'
import { MenuModule } from './modules/system/menu/menu.module'
import { RoleModule } from './modules/system/role/role.module'
import { UserModule } from './modules/system/user/user.module'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: configLoaders, validate: validateEnv }),
    // 全局限流 300 次/分/IP；登录接口 10 次/分在 AuthController 单独配置
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    PrismaModule,
    RedisModule,
    AuthModule,
    DashboardModule,
    UserModule,
    RoleModule,
    MenuModule,
    DeptModule,
    DictModule,
    LogModule,
  ],
  providers: [
    JwtStrategy,
    // 守卫链顺序固定（见 ARCHITECTURE.md 4.2）：限流 → 认证 → 鉴权
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    { provide: APP_INTERCEPTOR, useClass: OperationLogInterceptor },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class AppModule {}
