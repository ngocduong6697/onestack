import { Module } from '@nestjs/common'
import { OrgsModule } from '../orgs/orgs.module'
import { CustomersController } from './customers.controller'
import { CustomersService } from './customers.service'

@Module({
  // OrgGuard and WorkspaceGuard come from here; SessionGuard is global.
  imports: [OrgsModule],
  controllers: [CustomersController],
  providers: [CustomersService],
  exports: [CustomersService],
})
export class CustomersModule {}
