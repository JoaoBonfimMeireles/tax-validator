import type { InstanceOptions, IOContext } from '@vtex/api'
import { ExternalClient } from '@vtex/api'

import { paraHttp, safe, tentarJson } from '../utils/http'
import { resumir } from '../utils/tax'

export class Whirlpool extends ExternalClient {
  constructor(ctx: IOContext, options?: InstanceOptions) {
    super('http://api.whirlpool.com', ctx, {
      ...options,
      headers: {
        ...(options?.headers ?? {}),
        'X-Vtex-Use-Https': 'true',
      },
    })
  }

  public async obterToken(tokenUrl: string, basic: string): Promise<string> {
    const r = await safe<any>(() =>
      this.http.postRaw(paraHttp(tokenUrl), 'grant_type=client_credentials', {
        headers: {
          grant_type: 'client_credentials',
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        metric: 'whirlpool-token',
      })
    )

    if (r.status === 0 || r.status >= 300) {
      throw new Error(`Token HTTP ${r.status}: ${resumir(r.data)}`)
    }

    const token = tentarJson(r.data)?.access_token

    if (!token) throw new Error('A API Whirlpool não retornou access_token.')

    return token
  }

  public consultarImpostos(taxUrl: string, token: string, payload: unknown) {
    return safe<any>(() =>
      this.http.postRaw(paraHttp(taxUrl), payload, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        metric: 'whirlpool-tax',
      })
    )
  }
}
