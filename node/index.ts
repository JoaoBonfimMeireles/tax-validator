import type {
  ClientsConfig,
  ParamsContext,
  RecorderState,
  ServiceContext,
} from '@vtex/api'
import { method, Service } from '@vtex/api'

import { Clients } from './clients'
import { auth } from './middlewares/auth'
import { consultar } from './middlewares/consultar'

const clients: ClientsConfig<Clients> = {
  implementation: Clients,
  options: {
    default: { retries: 1, timeout: 20000 },
    whirlpool: { retries: 0, timeout: 25000 },
  },
}

declare global {
  type Context = ServiceContext<Clients, State>

  interface State extends RecorderState {
    userToken: string
    userEmail: string
  }
}

export default new Service<Clients, State, ParamsContext>({
  clients,
  routes: {
    consultar: method({ POST: [auth, consultar] }),
  },
})
