import { randomBytes } from 'crypto'

import { DOCK_ID, EAN_PADRAO, PAYMENT_CODE, TAX_CODE } from './constants'

export type Nivel = 'ok' | 'warn' | 'erro'
export type Diag = Array<[string, string | number]>
export type LinhaImposto = [string, number]

export interface Produto {
  skuId: string
  productId: string
  brandId: string
  categoryId: string
  ean: string
  refId: string
  unitMultiplier: number
  measurementUnit: string
  sellerId: string
  name: string
  matchedBy: string
}

export const round2 = (n: number) => Math.round(n * 100) / 100

export function parseNumeroBR(v: unknown): number {
  if (typeof v === 'number') return v
  let s = String(v ?? '')
    .trim()
    .replace(/\s/g, '')
    .replace(/r\$/gi, '')

  if (s.includes(',') && s.includes('.'))
    s = s.replace(/\./g, '').replace(',', '.')
  else s = s.replace(',', '.')

  return s === '' ? NaN : Number(s)
}

export function resumir(txt: unknown, max = 300): string {
  const s = typeof txt === 'string' ? txt : JSON.stringify(txt ?? '')

  return s.length > max ? `${s.substring(0, max)}…` : s
}

export function hojeAAAAMMDD(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(new Date())
    .replace(/-/g, '')
}

export const agoraBR = () =>
  new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })

export function montarPayload(
  sapId: string,
  preco: number,
  p: Produto,
  warehouseId: string,
  freight: number
) {
  return {
    cacheValidation: false,
    items: [
      {
        id: '1',
        sku: p.skuId,
        ean: p.ean || EAN_PADRAO,
        refId: p.refId,
        unitMultiplier: p.unitMultiplier || 1,
        measurementUnit: p.measurementUnit || 'un',
        targetPrice: preco,
        itemPrice: preco,
        quantity: 1,
        discountPrice: 0,
        dockId: DOCK_ID,
        freightPrice: Number.isFinite(freight) ? freight : 0,
        brandId: p.brandId,
        taxCode: TAX_CODE,
        productId: p.productId,
        sellerId: p.sellerId,
        categoryId: p.categoryId,
        discountPercentage: 0,
        warehouseId,
      },
    ],
    paymentCode: PAYMENT_CODE,
    orderDate: hojeAAAAMMDD(),
    taxApp: {
      fields: {
        sapId,
        orderFormId: randomBytes(15).toString('hex'),
        itemsWarehouse: [{ itemId: p.skuId, warehouseId }],
      },
      id: 'tax-custom-infos',
      major: 1,
    },
  }
}

export function extrairImpostos(response: any): LinhaImposto[] {
  const linhas: LinhaImposto[] = []

  const push = (t: any) => {
    if (!t) return
    const valor = Number(t.value != null ? t.value : t.amount) || 0
    const desc =
      t.description != null && t.description !== ''
        ? t.description
        : t.name || t.type || t.code || 'imposto'

    linhas.push([String(desc), round2(valor)])
  }

  const coletar = (n: any): void => {
    if (!n) return
    if (Array.isArray(n)) {
      n.forEach(coletar)

      return
    }
    if (Array.isArray(n.taxes)) n.taxes.forEach(push)
    if (Array.isArray(n.items)) n.items.forEach(coletar)
    if (Array.isArray(n.data)) n.data.forEach(coletar)
    if (n.result) coletar(n.result)
  }

  coletar(response)

  return linhas
}

export function extrairErroDoCorpo(resp: any): string {
  if (!resp || typeof resp !== 'object') return ''

  if (Array.isArray(resp)) {
    for (const r of resp) {
      const e = extrairErroDoCorpo(r)

      if (e) return e
    }

    return ''
  }

  const campos = [
    'error',
    'errorMessage',
    'error_description',
    'faultstring',
    'detail',
    'moreInformation',
    'title',
    'Message',
    'message',
  ]

  for (const c of campos) {
    const v = resp[c]

    if (
      v &&
      typeof v === 'string' &&
      v.trim() &&
      !/^(ok|success|sucesso)\.?$/i.test(v.trim())
    )
      return v.trim()
  }

  if (Array.isArray(resp.errors) && resp.errors.length) {
    return resp.errors
      .map((x: any) =>
        typeof x === 'string' ? x : x.message || x.Message || JSON.stringify(x)
      )
      .join('; ')
  }

  if (resp.status && Number(resp.status) >= 400) {
    return `status ${resp.status}${resp.message ? `: ${resp.message}` : ''}`
  }

  return ''
}

export function dumpCamposResposta(resp: any): Diag {
  const out: Diag = []

  try {
    const alvo = Array.isArray(resp) ? resp[0] || {} : resp || {}

    for (const k of Object.keys(alvo)) {
      if (out.length >= 12) break
      const v = alvo[k]

      if (v == null) continue
      if (k.toLowerCase() === 'taxes')
        out.push([
          `resp.${k}`,
          Array.isArray(v) ? `${v.length} item(ns)` : '(objeto)',
        ])
      else if (typeof v === 'object')
        out.push([`resp.${k}`, resumir(JSON.stringify(v), 120)])
      else out.push([`resp.${k}`, String(v)])
    }

    if (!out.length)
      out.push(['resp (bruto)', resumir(JSON.stringify(resp), 200)])
  } catch {
    out.push(['resp', '(não foi possível ler o corpo)'])
  }

  return out
}

export function classificarResultado(
  linhas: LinhaImposto[],
  soma: number,
  preco: number,
  response: any
) {
  const extras: Diag = []

  if (!linhas.length) {
    return {
      nivel: 'warn' as Nivel,
      mensagem:
        'A Tax API respondeu SEM nenhum imposto. Causa provável: SAP ID inexistente/incorreto para esta conta, ou produto sem regra fiscal.',
      extras: dumpCamposResposta(response),
    }
  }

  const zerados = linhas.filter((l) => Math.abs(Number(l[1]) || 0) < 0.005)
    .length

  if (zerados === linhas.length) {
    return {
      nivel: 'warn' as Nivel,
      mensagem: `Todos os ${linhas.length} impostos vieram ZERADOS. Verifique: SAP ID (existe? é o certo?), preço (${preco}) e warehouseId.`,
      extras: dumpCamposResposta(response),
    }
  }

  if (soma <= 0) {
    return {
      nivel: 'warn' as Nivel,
      mensagem: `A soma dos impostos ficou ${soma} (<= 0), apesar de vir ${linhas.length} linha(s). Verifique SAP ID, preço (${preco}) e warehouseId.`,
      extras: dumpCamposResposta(response),
    }
  }

  if (preco > 0 && soma > preco * 2) {
    return {
      nivel: 'warn' as Nivel,
      mensagem: `Soma dos impostos (${soma}) passou de 2x o preço (${preco}). Provável erro de dado: preço, unidade de medida ou warehouse.`,
      extras,
    }
  }

  if (zerados > 0)
    extras.push(['Impostos zerados', `${zerados} de ${linhas.length}`])

  return {
    nivel: 'ok' as Nivel,
    mensagem: `Sucesso — ${linhas.length} imposto(s), soma ${soma}${
      zerados ? ` (${zerados} zerado(s))` : ''
    }`,
    extras,
  }
}
