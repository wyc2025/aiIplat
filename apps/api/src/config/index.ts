import databaseConfig from './database.config'
import redisConfig from './redis.config'
import jwtConfig from './jwt.config'
import uploadConfig from './upload.config'
import siteConfig from './site.config'

/** ConfigModule.forRoot({ load }) 统一注册入口 */
export const configLoaders = [databaseConfig, redisConfig, jwtConfig, uploadConfig, siteConfig]
