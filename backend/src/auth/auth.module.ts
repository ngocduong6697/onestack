import { Global, Module } from '@nestjs/common'
import { OrgsModule } from '../orgs/orgs.module'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { SessionGuard } from './session.guard'

/**
 * Global for the same reason DatabaseModule is: every feature module needs the
 * session guard, and importing it everywhere would only invite a second
 * instance. It also breaks what would otherwise be a cycle — registration
 * needs OrgsService, and every scoped controller needs SessionGuard.
 */
@Global()
@Module({
  imports: [OrgsModule],
  controllers: [AuthController],
  providers: [AuthService, SessionGuard],
  exports: [AuthService, SessionGuard],
})
export class AuthModule {}
