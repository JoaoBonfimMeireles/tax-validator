import type { InstanceOptions, IOContext } from '@vtex/api'
import { ExternalClient } from '@vtex/api'

import { safe } from '../utils/http'

export class VtexApi extends ExternalClient {
  constructor(ctx: IOContext, options?: InstanceOptions) {
    super(`http://${ctx.account}.vtexcommercestable.com.br`, ctx, {
      ...options,
      headers: {
        ...(options?.headers ?? {}),
        Accept: 'application/json',
        'X-Vtex-Use-Https': 'true',
        'Proxy-Authorization': ctx.authToken,
      },
    })
  }

  private user(token: string) {
    return { VtexIdclientAutCookie: token }
  }

  public async validarToken(token: string) {
    try {
      return await this.http.post<{ authStatus?: string; user?: string }>(
        '/api/vtexid/credential/validate',
        { token },
        { metric: 'tax-vtexid-validate' }
      )
    } catch {
      return null
    }
  }

  public buscarProdutos(campo: string, valor: string, sc: string) {
    return safe<any[]>(() =>
      this.http.getRaw('/api/catalog_system/pub/products/search', {
        params: { fq: `${campo}:${valor}`, sc },
        metric: 'tax-search',
      })
    )
  }

  public produtoPorRefId(refId: string, token: string) {
    return safe(() =>
      this.http.getRaw(
        `/api/catalog_system/pvt/products/productgetbyrefid/${encodeURIComponent(
          refId
        )}`,
        { headers: this.user(token), metric: 'tax-productgetbyrefid' }
      )
    )
  }

  public simular(skuId: string, sellerId: string, cep: string, sc: string) {
    return safe(() =>
      this.http.postRaw(
        '/api/checkout/pub/orderForms/simulation',
        {
          items: [{ id: String(skuId), quantity: 1, seller: String(sellerId) }],
          country: 'BRA',
          postalCode: cep,
        },
        { params: { RnbBehavior: 0, sc }, metric: 'tax-simulation' }
      )
    )
  }

  public inventario(skuId: string, token: string) {
    return safe(() =>
      this.http.getRaw(
        `/api/logistics/pvt/inventory/skus/${encodeURIComponent(skuId)}`,
        {
          headers: this.user(token),
          metric: 'tax-inventory',
        }
      )
    )
  }

  public mdGet(
    path: string,
    params: Record<string, any>,
    headers: Record<string, string>
  ) {
    return safe(() =>
      this.http.getRaw(path, {
        params,
        headers: {
          ...headers,
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
        },
        metric: 'tax-masterdata',
        memoizable: false,
        cacheable: 0,
      } as any)
    )
  }
}
