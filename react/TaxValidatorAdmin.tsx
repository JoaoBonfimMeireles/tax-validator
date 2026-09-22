import React, { useState } from 'react'
import { Layout, PageHeader, PageBlock, Input, Button } from 'vtex.styleguide'

type Nivel = 'ok' | 'warn' | 'erro'

interface Resultado {
  nivel: Nivel
  mensagem: string
  impostos: Array<{ descricao: string; valor: number; ok: boolean }>
  diag: Array<[string, string | number]>
  executadoEm: string
}

const COR: Record<Nivel, string> = {
  ok: '#188038',
  warn: '#b06000',
  erro: '#b00020',
}
const ICONE: Record<Nivel, string> = { ok: '✅', warn: '⚠️', erro: '❌' }
const ZEBRA = '#f4f7fb'
const OFF = '#9aa0a6'
const fmt = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 12px',
  color: '#fff',
  fontWeight: 600,
}
const td: React.CSSProperties = {
  padding: '8px 12px',
  borderBottom: '1px solid #e3e4e6',
}

const agora = () => new Date().toLocaleString('pt-BR')

function normalizar(d: any, status: number): Resultado {
  const nivel: Nivel =
    d?.nivel === 'ok' || d?.nivel === 'warn' ? d.nivel : 'erro'

  return {
    nivel,
    mensagem: String(
      d?.mensagem ??
        d?.message ??
        d?.error ??
        `Resposta inesperada do servidor (HTTP ${status}).`
    ),
    impostos: Array.isArray(d?.impostos)
      ? d.impostos.map((l: any) => ({
          descricao: String(l?.descricao ?? ''),
          valor: Number(l?.valor) || 0,
          ok: Boolean(l?.ok),
        }))
      : [],
    diag: Array.isArray(d?.diag)
      ? d.diag
          .filter(Array.isArray)
          .map((x: any[]) => [String(x[0] ?? ''), x[1] == null ? '' : x[1]])
      : [],
    executadoEm: String(d?.executadoEm ?? agora()),
  }
}

const TaxValidatorAdmin = () => {
  const [sapId, setSapId] = useState('')
  const [ident, setIdent] = useState('')
  const [preco, setPreco] = useState('')
  const [loading, setLoading] = useState(false)
  const [res, setRes] = useState<Resultado | null>(null)

  const consultar = async () => {
    if (loading) return
    setLoading(true)
    try {
      const r = await fetch('/_v/tax-validator/consultar', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sapId, identificador: ident, preco }),
      })

      const txt = await r.text()
      let data: any = null

      try {
        data = JSON.parse(txt)
      } catch {
        data = {
          mensagem: `HTTP ${r.status} — resposta não é JSON: ${txt.slice(
            0,
            200
          )}`,
        }
      }

      setRes(normalizar(data, r.status))
    } catch (e) {
      setRes(
        normalizar(
          { mensagem: `Falha de rede: ${(e as Error)?.message ?? e}` },
          0
        )
      )
    } finally {
      setLoading(false)
    }
  }

  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') consultar()
  }

  const impostos = res?.impostos ?? []

  return (
    <Layout pageHeader={<PageHeader title="🧾 Validação de Impostos (SAP)" />}>
      <PageBlock title="Consulta" variation="full">
        <div className="flex flex-wrap" style={{ gap: 16 }}>
          <div style={{ minWidth: 180, flex: 1 }}>
            <Input
              label="SAP ID"
              value={sapId}
              onKeyDown={onEnter}
              onChange={(e: any) => setSapId(e.target.value)}
              placeholder="0000"
            />
          </div>
          <div style={{ minWidth: 180, flex: 1 }}>
            <Input
              label="skuId ou refId"
              value={ident}
              onKeyDown={onEnter}
              onChange={(e: any) => setIdent(e.target.value)}
              placeholder="ABC000"
            />
          </div>
          <div style={{ minWidth: 140, flex: 1 }}>
            <Input
              label="Preço do produto"
              value={preco}
              onKeyDown={onEnter}
              onChange={(e: any) => setPreco(e.target.value)}
              placeholder="0,00"
            />
          </div>
        </div>
        <div className="mt3 c-muted-1 t-small">
          O CEP é buscado automaticamente no centro de custo da organização do
          SAP ID.
        </div>
        <div className="mt5">
          <Button variation="primary" isLoading={loading} onClick={consultar}>
            Consultar impostos
          </Button>
        </div>
      </PageBlock>

      <PageBlock variation="full">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#38761d' }}>
              <th style={th}>Imposto</th>
              <th style={{ ...th, textAlign: 'right' }}>Valor</th>
              <th style={{ ...th, textAlign: 'center', width: 60 }}>OK</th>
            </tr>
          </thead>
          <tbody>
            {impostos.length === 0 && (
              <tr>
                <td style={{ ...td, color: OFF }} colSpan={3}>
                  Nenhum imposto para exibir.
                </td>
              </tr>
            )}
            {impostos.map((l, i) => (
              <tr
                key={`${l.descricao}-${i}`}
                style={{ background: i % 2 ? ZEBRA : '#fff' }}
              >
                <td style={td}>{l.descricao}</td>
                <td style={{ ...td, textAlign: 'right' }}>
                  {fmt.format(l.valor)}
                </td>
                <td
                  style={{
                    ...td,
                    textAlign: 'center',
                    fontWeight: 700,
                    fontSize: 16,
                    color: l.ok ? COR.ok : OFF,
                  }}
                >
                  {l.ok ? '✔' : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </PageBlock>

      {res && (
        <PageBlock variation="full">
          <div
            style={{
              background: COR[res.nivel],
              color: '#fff',
              fontWeight: 700,
              padding: '8px 12px',
            }}
          >
            RETORNO DA CONSULTA
          </div>
          <div
            style={{
              color: COR[res.nivel],
              fontWeight: 700,
              padding: 12,
              whiteSpace: 'pre-wrap',
            }}
          >
            {ICONE[res.nivel]} {res.mensagem}
          </div>
          <div style={{ color: OFF, padding: '0 12px 12px' }}>
            Executado em {res.executadoEm}
          </div>

          {res.diag.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: ZEBRA }}>
                  <th style={{ ...th, color: '#000', width: '30%' }}>Campo</th>
                  <th style={{ ...th, color: '#000' }}>Valor resolvido</th>
                </tr>
              </thead>
              <tbody>
                {res.diag.map(([campo, valor], i) => (
                  <tr
                    key={`${campo}-${i}`}
                    style={{ background: i % 2 ? ZEBRA : '#fff' }}
                  >
                    <td style={td}>{campo}</td>
                    <td style={{ ...td, wordBreak: 'break-word' }}>
                      {String(valor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </PageBlock>
      )}
    </Layout>
  )
}

export default TaxValidatorAdmin
