import type { Config } from '../utils/config'
import { tentarJson } from '../utils/http'
import type { Diag, Produto } from '../utils/tax'

async function buscarNaSearch(
  ctx: Context,
  campo: string,
  valor: string,
  identMatch: string,
  cfg: Config
) {
  const res = await ctx.clients.vtexApi.buscarProdutos(
    campo,
    valor,
    cfg.salesChannel
  )

  if (res.status === 0 || res.status >= 300)
    return { info: `HTTP ${res.status}` }

  const arr = tentarJson(res.data)

  if (arr === undefined) return { info: 'JSON inválido' }
  if (!Array.isArray(arr) || !arr.length) return { info: '0 produtos' }

  const prod = arr[0]
  const items: any[] = prod.items || []
  const item =
    items.find(
      (it) =>
        (it.referenceId || []).some(
          (r: any) => String(r.Value) === String(identMatch)
        ) || String(it.itemId) === String(identMatch)
    ) ?? items[0]

  if (!item) return { info: `produto ${prod.productId} sem SKUs` }

  const refObj = (item.referenceId || []).find((r: any) => r.Key === 'RefId')

  let catLeaf = String(prod.categoryId || '')
    .replace(/\//g, '')
    .trim()

  if (!catLeaf) {
    const cids = String((prod.categoriesIds || [])[0] || '')
      .split('/')
      .filter(String)

    catLeaf = cids.length ? cids[cids.length - 1] : ''
  }

  const sellers: any[] = item.sellers || []
  const sellerId =
    (sellers.find((s) => s.sellerDefault) || sellers[0] || {}).sellerId ||
    cfg.sellerIdPadrao

  const resolved: Produto = {
    skuId: String(item.itemId),
    productId: String(prod.productId || ''),
    brandId: String(prod.brandId || ''),
    categoryId: String(catLeaf || ''),
    ean: String(item.ean || ''),
    refId: String(refObj?.Value || prod.productReference || identMatch),
    unitMultiplier: Number(item.unitMultiplier) || 1,
    measurementUnit: item.measurementUnit || 'un',
    taxCode: cfg.taxCode,
    sellerId: String(sellerId),
    name: prod.productName || '',
    matchedBy: `search ${campo}=${valor}`,
  }

  return { info: `OK (skuId ${item.itemId})`, resolved }
}

export async function resolverProduto(
  ctx: Context,
  ident: string,
  cfg: Config,
  diag: Diag
): Promise<Produto> {
  const tent: string[] = []

  const a = await buscarNaSearch(ctx, 'alternateIds_RefId', ident, ident, cfg)

  tent.push(`alternateIds_RefId=${ident} → ${a.info}`)
  if (a.resolved) return a.resolved

  if (/^[0-9]+$/.test(ident)) {
    const b = await buscarNaSearch(ctx, 'skuId', ident, ident, cfg)

    tent.push(`skuId=${ident} → ${b.info}`)
    if (b.resolved) return b.resolved

    const c = await buscarNaSearch(ctx, 'productId', ident, ident, cfg)

    tent.push(`productId=${ident} → ${c.info}`)
    if (c.resolved) return c.resolved
  }

  const e = await ctx.clients.vtexApi.produtoPorRefId(
    ident,
    ctx.state.userToken
  )

  tent.push(`pvt productgetbyrefid → HTTP ${e.status}`)

  const pr = e.status > 0 && e.status < 300 ? tentarJson(e.data) : null

  if (pr?.Id) {
    const d = await buscarNaSearch(ctx, 'productId', String(pr.Id), ident, cfg)

    tent.push(`productId=${pr.Id} → ${d.info}`)
    if (d.resolved) return d.resolved
  }

  diag.push(['Diagnóstico da busca', tent.join('  |  ')])
  throw new Error(
    `Não encontrei o produto para "${ident}". Tentativas → ${tent.join(
      '  |  '
    )}`
  )
}

/* ---------------- ENTREGA / WAREHOUSE ---------------- */

export async function resolverEntrega(
  ctx: Context,
  skuId: string,
  sellerId: string,
  cep: string,
  cfg: Config
) {
  const out = {
    warehouseId: '',
    warehouseName: '',
    warehouseSource: '',
    freight: 0,
    freightSource: '',
  }
  const { vtexApi } = ctx.clients

  const sim = await vtexApi.simular(
    skuId,
    sellerId || cfg.sellerIdPadrao,
    cep,
    cfg.salesChannel
  )
  let sla0: any = null

  if (sim.status > 0 && sim.status < 300) {
    sla0 = tentarJson(sim.data)?.logisticsInfo?.[0]?.slas?.[0] ?? null
  }

  if (sla0) {
    out.freight = Math.round(Number(sla0.price) || 0) / 100
    out.freightSource = `simulação — CEP ${cep}, SLA "${
      sla0.name || sla0.id || '?'
    }"`
    const did = (sla0.deliveryIds || [])[0]

    if (did?.warehouseId) {
      out.warehouseId = String(did.warehouseId)
      out.warehouseName = String(did.warehouseName || '')
      out.warehouseSource = `simulação (CEP ${cep})`
    }
  } else {
    out.freightSource = `simulação sem entrega para o CEP ${cep} (HTTP ${sim.status}) — frete = 0`
  }

  if (!out.warehouseId) {
    const inv = await vtexApi.inventario(skuId, ctx.state.userToken)
    const balance: any[] =
      (inv.status > 0 && inv.status < 300 && tentarJson(inv.data)?.balance) ||
      []

    if (balance.length) {
      const lista = balance
        .map((b) => ({
          id: String(b.warehouseId),
          name: String(b.warehouseName || ''),
          disp: b.hasUnlimitedQuantity
            ? Number.POSITIVE_INFINITY
            : (Number(b.totalQuantity) || 0) -
              (Number(b.reservedQuantity) || 0),
        }))
        .sort((x, y) => y.disp - x.disp)

      const pick =
        lista[0].disp > 0
          ? lista[0]
          : {
              id: String(balance[0].warehouseId),
              name: String(balance[0].warehouseName || ''),
            }

      out.warehouseId = pick.id
      out.warehouseName = pick.name
      out.warehouseSource = 'inventário (a simulação não trouxe warehouse)'
    }
  }

  if (!out.warehouseId && cfg.warehousePadrao) {
    out.warehouseId = cfg.warehousePadrao
    out.warehouseSource = 'configuração "Warehouse padrão"'
  }

  if (!out.warehouseId) {
    throw new Error(
      `Não consegui resolver o warehouseId (simulação sem SLA para o CEP ${cep} e inventário indisponível). ` +
        'Confira o CEP, sua permissão de Logística no admin, ou preencha "Warehouse padrão" nas configurações do app.'
    )
  }

  return out
}
