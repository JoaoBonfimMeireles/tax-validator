export interface Config {
  basic: string
  tokenUrl: string
  taxUrl: string
}

const s = (v: unknown, padrao = '') => {
  const t = String(v ?? '').trim()

  return t || padrao
}

export async function lerConfig(ctx: Context): Promise<Config> {
  const st: any =
    (await ctx.clients.apps.getAppSettings(
      process.env.VTEX_APP_ID as string
    )) ?? {}

  return {
    basic: s(st.basicAuth),
    tokenUrl: s(st.tokenUrl, 'https://api.whirlpool.com/oauth2/v1/token'),
    taxUrl: s(
      st.taxUrl,
      'https://api.whirlpool.com/d2c/v1/merx2/ecc-service/tax-api'
    ),
  }
}
