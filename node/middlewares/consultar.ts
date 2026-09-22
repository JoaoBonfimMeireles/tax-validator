import { json } from 'co-body'

import { resolverCep } from '../services/cep'
import { resolverEntrega, resolverProduto } from '../services/resolvers'
import { lerConfig } from '../utils/config'
import { EAN_PADRAO } from '../utils/constants'
import { tentarJson } from '../utils/http'
import type { Diag, LinhaImposto } from '../utils/tax'
import {
  agoraBR,
  classificarResultado,
  extrairErroDoCorpo,
  extrairImpostos,
  montarPayload,
  parseNumeroBR,
  resumir,
  round2,
} from '../utils/tax'

export async function consultar(ctx: Context) {
  const t0 = Date.now()
  const diag: Diag = []

  ctx.status = 200

  try {
    const cfg = await lerConfig(ctx)
    const body = ((await json(ctx.req)) ?? {}) as Record<string, unknown>

    const sapId = String(body.sapId ?? '').trim()
    const ident = String(body.identificador ?? '').trim()
    const precoRaw = body.preco ?? ''
    const preco = parseNumeroBR(precoRaw)

    diag.push(['SAP ID', sapId || '(vazio)'])
    diag.push(['Identificador (skuId/refId)', ident || '(vazio)'])
    diag.push(['Preço', Number.isFinite(preco) ? preco : '(inválido)'])

    if (!sapId) throw new Error('Preencha o SAP ID.')
    if (!ident) throw new Error('Preencha o skuId ou o refId.')
    if (!Number.isFinite(preco) || preco <= 0) {
      throw new Error(
        `Preço inválido (aceita 7,38 / 7.38 / 7). Valor lido: "${precoRaw}".`
      )
    }
    if (!cfg.basic) {
      throw new Error(
        'A credencial BASIC não está configurada. Vá em Apps > Meus apps > Validador de Impostos > Configurações.'
      )
    }
    if (!/^[0-9]+$/.test(sapId)) {
      diag.push([
        '⚠ SAP ID',
        `não é só números ("${sapId}") — confira se está correto`,
      ])
    }

    const cepInfo = await resolverCep(ctx, sapId, diag)

    diag.push(['CEP de entrega', `${cepInfo.cep} — ${cepInfo.source}`])

    const p = await resolverProduto(ctx, ident, diag)

    diag.push(['skuId', p.skuId])
    diag.push(['Identificado por', p.matchedBy])
    diag.push(['refId', p.refId || '(sem refId)'])
    diag.push(['EAN', p.ean || EAN_PADRAO])
    diag.push(['productId', p.productId || '(n/d)'])
    diag.push(['brandId', p.brandId || '(n/d)'])
    diag.push(['categoryId', p.categoryId || '(n/d)'])
    diag.push(['sellerId', p.sellerId])
    diag.push(['Produto', p.name || ''])

    const ent = await resolverEntrega(ctx, p.skuId, p.sellerId, cepInfo.cep)

    diag.push([
      'warehouseId',
      ent.warehouseId + (ent.warehouseName ? ` — ${ent.warehouseName}` : ''),
    ])
    diag.push(['Origem do warehouse', ent.warehouseSource])
    diag.push(['Frete unitário', ent.freight])
    diag.push(['Origem do frete', ent.freightSource])
    if (ent.freight === 0) {
      diag.push([
        '⚠ Frete',
        `frete = 0 → os impostos podem não bater com a PDP. CEP usado: ${cepInfo.cep} (${cepInfo.source}).`,
      ])
    }

    const token = await ctx.clients.whirlpool.obterToken(
      cfg.tokenUrl,
      cfg.basic
    )

    diag.push(['Token Whirlpool', 'ok'])

    const payload = montarPayload(sapId, preco, p, ent.warehouseId, ent.freight)
    const r = await ctx.clients.whirlpool.consultarImpostos(
      cfg.taxUrl,
      token,
      payload
    )

    diag.push(['HTTP Tax API', r.status])

    if (r.status === 0 || r.status >= 300) {
      throw new Error(`Tax API HTTP ${r.status}: ${resumir(r.data, 400)}`)
    }

    const response = tentarJson(r.data)

    if (response === undefined) {
      throw new Error(
        `A Tax API respondeu algo que não é JSON (HTTP ${r.status}): ${resumir(
          r.data,
          400
        )}`
      )
    }

    const linhas = extrairImpostos(response)
    const erroCorpo = extrairErroDoCorpo(response)

    if (erroCorpo && !linhas.length) {
      throw new Error(
        `A Tax API retornou erro no corpo (HTTP ${r.status}): ${erroCorpo}`
      )
    }

    const soma = round2(linhas.reduce((acc, l) => acc + (Number(l[1]) || 0), 0))
    const base = round2(preco + ent.freight)

    diag.push(['Impostos retornados', linhas.length])
    diag.push(['Soma dos impostos', soma])
    diag.push(['Base de cálculo', `${preco} + frete ${ent.freight} = ${base}`])
    if (base > 0)
      diag.push(['% sobre a base', `${((soma / base) * 100).toFixed(1)}%`])
    if (erroCorpo) diag.push(['⚠ Mensagem no corpo', erroCorpo])

    const cls = classificarResultado(linhas, soma, preco, response)

    if (erroCorpo && cls.nivel === 'ok') {
      cls.nivel = 'warn'
      cls.mensagem = `Impostos vieram, mas a Tax API mandou mensagem no corpo: ${erroCorpo}`
    }

    cls.extras.forEach((e) => diag.push(e))

    const todas: LinhaImposto[] = [
      ...linhas,
      ['Frete unitário', round2(ent.freight)],
    ]

    ctx.body = {
      nivel: cls.nivel,
      mensagem: `${cls.mensagem}  (${Date.now() - t0} ms)`,
      impostos: todas.map(([descricao, valor]) => ({
        descricao,
        valor,
        ok: valor > 0,
      })),
      diag,
      executadoEm: agoraBR(),
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)

    ctx.body = {
      nivel: 'erro',
      mensagem: msg,
      impostos: [],
      diag,
      executadoEm: agoraBR(),
    }
  }
}
