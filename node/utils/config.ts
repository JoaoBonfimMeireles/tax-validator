export interface Config {
  basic: string
  appKey: string
  appToken: string
  tokenUrl: string
  taxUrl: string
  paymentCode: string
  salesChannel: string
  sellerIdPadrao: string
  warehousePadrao: string
  eanPadrao: string
  dockId: string
  taxCode: string
  orderDateFixa: string
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
    appKey: s(st.appKey),
    appToken: s(st.appToken),
    tokenUrl: s(st.tokenUrl, 'https://api.whirlpool.com/oauth2/v1/token'),
    taxUrl: s(
      st.taxUrl,
      'https://api.whirlpool.com/d2c/v1/merx2/ecc-service/tax-api'
    ),
    paymentCode: s(st.paymentCode, 'H001'),
    salesChannel: s(st.salesChannel, '1'),
    sellerIdPadrao: s(st.sellerIdPadrao, '1'),
    warehousePadrao: s(st.warehousePadrao),
    eanPadrao: s(st.eanPadrao, '0'),
    dockId: s(st.dockId, '0'),
    taxCode: s(st.taxCode),
    orderDateFixa: s(st.orderDateFixa),
  }
}
