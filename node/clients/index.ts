import { IOClients } from '@vtex/api'

import { VtexApi } from './vtexApi'
import { Whirlpool } from './whirlpool'

export class Clients extends IOClients {
  public get vtexApi() {
    return this.getOrSet('vtexApi', VtexApi)
  }

  public get whirlpool() {
    return this.getOrSet('whirlpool', Whirlpool)
  }
}
