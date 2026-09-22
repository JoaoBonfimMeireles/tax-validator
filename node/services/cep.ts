import type { Config } from '../utils/config'
import { tentarJson } from '../utils/http'
import type { Diag } from '../utils/tax'
import { resumir } from '../utils/tax'

/* ================= tipos / cache ================= */

interface Org {
  id: string
  name: string
}
interface CepCC {
  cep: string
  ccName: string
  city: string
  state: string
}

interface Lista<T> {
  em: number
  mapa: Map<string, T>
  info: string
}

const TTL = 30 * 60 * 1000
const RECARGA_MIN = 60 * 1000
const TAM = 1000
const MAX_PAGINAS = 200

let orgsCache: Lista<Org> | null = null
let ccsCache: Lista<CepCC> | null = null
let orgsLoad: Promise<Lista<Org>> | null = null
let ccsLoad: Promise<Lista<CepCC>> | null = null

/* ================= helpers ================= */

const normSap = (v: unknown) =>
  String(v ?? '')
    .trim()
    .replace(/\.0+$/, '')
    .replace(/^0+(?=\d)/, '')

function normalizarCep(v: unknown): string {
  let cep = String(v ?? '').replace(/\D/g, '')

  if (cep.length === 7) cep = `0${cep}`

  return cep.length === 8 ? cep : ''
}

function authMd(ctx: Context, cfg: Config): Record<string, string> {
  if (cfg.appKey && cfg.appToken) {
    return {
      'X-VTEX-API-AppKey': cfg.appKey,
      'X-VTEX-API-AppToken': cfg.appToken,
    }
  }

  return { VtexIdclientAutCookie: ctx.state.userToken }
}

/**
 * Mesmo comportamento do fetchVtexDataScroll do Apps Script:
 * 1ª chamada com _fields/_size, depois só _token, até vir vazio.
 * _p é um cache-buster para o IO não devolver sempre a mesma página.
 */
async function scrollTudo(
  ctx: Context,
  cfg: Config,
  entidade: string,
  fields: string,
  onItem: (item: any) => void
): Promise<string> {
  const auth = authMd(ctx, cfg)
  const vistos = new Set<string>()
  let token = ''
  let total = 0

  for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
    const params = token
      ? { _token: token, _p: `${pagina}-${Date.now()}` }
      : { _fields: fields, _size: TAM, _p: `${pagina}-${Date.now()}` }

    const r = await ctx.clients.vtexApi.mdGet(
      `/api/dataentities/${entidade}/scroll`,
      params,
      auth
    )

    if (r.status === 0 || r.status >= 300) {
      if (pagina === 1) {
        throw new Error(
          `Não consegui ler "${entidade}" (HTTP ${r.status}): ${resumir(
            r.data,
            200
          )}. ` +
            'Preencha AppKey/AppToken nas configurações do app (as mesmas do Apps Script B2B).'
        )
      }

      return `${total} lidos em ${pagina - 1} página(s) — parou com HTTP ${
        r.status
      } (INCOMPLETO)`
    }

    const arr = tentarJson(r.data)

    if (!Array.isArray(arr) || !arr.length) {
      return `${total} lidos em ${pagina - 1} página(s) — completo`
    }

    let novos = 0

    for (const item of arr) {
      const id = String(item?.id ?? '')

      if (!id || vistos.has(id)) continue
      vistos.add(id)
      novos++
      onItem(item)
    }

    total += novos

    if (novos === 0) {
      return `${total} lidos em ${pagina} página(s) — paginação repetida, leitura interrompida (INCOMPLETO)`
    }

    if (!token) {
      const h = r.headers ?? {}

      token = String(
        h['x-vtex-md-token'] ??
          h['X-VTEX-MD-TOKEN'] ??
          h['X-Vtex-Md-Token'] ??
          ''
      )

      if (!token) {
        return arr.length < TAM
          ? `${total} lidos em 1 página — completo`
          : `${total} lidos — API não devolveu token de scroll (INCOMPLETO)`
      }
    }
  }

  return `${total} lidos — limite de ${MAX_PAGINAS} páginas (INCOMPLETO)`
}

/* ================= organizações: SAPID → org ================= */

async function carregarOrgs(ctx: Context, cfg: Config): Promise<Lista<Org>> {
  const mapa = new Map<string, Org>()

  const info = await scrollTudo(
    ctx,
    cfg,
    'organizations',
    'id,name,customFields',
    (org) => {
      const fields = Object.fromEntries(
        (org.customFields ?? []).map((f: any) => [f.name, f.value])
      )
      const sap = normSap(fields.SAPID)

      if (sap && !mapa.has(sap))
        mapa.set(sap, { id: String(org.id), name: String(org.name ?? '') })
    }
  )

  return { em: Date.now(), mapa, info: `${info}; ${mapa.size} SAPIDs` }
}

/* ================= centros de custo: org → CEP ================= */

async function carregarCcs(ctx: Context, cfg: Config): Promise<Lista<CepCC>> {
  const mapa = new Map<string, CepCC>()

  const info = await scrollTudo(
    ctx,
    cfg,
    'cost_centers',
    'id,name,organization,addresses',
    (cc) => {
      const org = String(cc.organization ?? '')

      if (!org || mapa.has(org)) return

      for (const addr of cc.addresses ?? []) {
        const cep = normalizarCep(addr?.postalCode)

        if (cep) {
          mapa.set(org, {
            cep,
            ccName: String(cc.name ?? cc.id),
            city: String(addr.city ?? ''),
            state: String(addr.state ?? ''),
          })

          return
        }
      }
    }
  )

  return { em: Date.now(), mapa, info: `${info}; ${mapa.size} orgs com CEP` }
}

/* ================= cache genérico ================= */

async function obter<T>(
  atual: Lista<T> | null,
  emAndamento: Promise<Lista<T>> | null,
  setLoad: (p: Promise<Lista<T>> | null) => void,
  setCache: (c: Lista<T>) => void,
  carregar: () => Promise<Lista<T>>,
  forcar: boolean
): Promise<Lista<T>> {
  const idade = atual ? Date.now() - atual.em : Infinity
  const incompleto = atual?.info.includes('INCOMPLETO') ?? false

  if (atual && !forcar && !incompleto && idade < TTL) return atual
  if (atual && forcar && idade < RECARGA_MIN) return atual
  if (emAndamento) return emAndamento

  const p = carregar()
    .then((c) => {
      setCache(c)

      return c
    })
    .finally(() => setLoad(null))

  setLoad(p)

  return p
}

const obterOrgs = (ctx: Context, cfg: Config, forcar = false) =>
  obter(
    orgsCache,
    orgsLoad,
    (p) => (orgsLoad = p),
    (c) => (orgsCache = c),
    () => carregarOrgs(ctx, cfg),
    forcar
  )

const obterCcs = (ctx: Context, cfg: Config, forcar = false) =>
  obter(
    ccsCache,
    ccsLoad,
    (p) => (ccsLoad = p),
    (c) => (ccsCache = c),
    () => carregarCcs(ctx, cfg),
    forcar
  )

/* ================= principal ================= */

export async function resolverCep(
  ctx: Context,
  sapId: string,
  cfg: Config,
  diag: Diag
) {
  const alvo = normSap(sapId)

  let orgs = await obterOrgs(ctx, cfg)
  let org = orgs.mapa.get(alvo)

  if (!org) {
    orgs = await obterOrgs(ctx, cfg, true)
    org = orgs.mapa.get(alvo)
  }

  diag.push(['Organizações', orgs.info])

  if (!org) {
    throw new Error(
      `SAP ID ${sapId} não foi encontrado no campo SAPID das organizações B2B. (${orgs.info})`
    )
  }

  diag.push(['Organização', `${org.name} (${org.id})`])

  let ccs = await obterCcs(ctx, cfg)
  let hit = ccs.mapa.get(org.id)

  if (!hit) {
    ccs = await obterCcs(ctx, cfg, true)
    hit = ccs.mapa.get(org.id)
  }

  diag.push(['Centros de custo', ccs.info])

  if (!hit) {
    throw new Error(
      `SAP ID ${sapId} pertence à organização "${org.name}", mas nenhum centro de custo dela tem endereço com CEP válido. (${ccs.info})`
    )
  }

  return {
    cep: hit.cep,
    source: `centro de custo "${hit.ccName}" da org "${org.name}"${
      hit.city ? ` — ${hit.city}/${hit.state}` : ''
    }`,
  }
}
