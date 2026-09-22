export async function auth(ctx: Context, next: () => Promise<any>) {
  ctx.set('Cache-Control', 'no-store')

  const token =
    ctx.vtex.adminUserAuthToken ??
    ctx.cookies.get('VtexIdclientAutCookie') ??
    (ctx.get('VtexIdclientAutCookie') || undefined)

  const negar = (mensagem: string) => {
    ctx.status = 401
    ctx.body = {
      nivel: 'erro',
      mensagem,
      impostos: [],
      diag: [],
      executadoEm: new Date().toISOString(),
    }
  }

  if (!token)
    return negar(
      'Sessão do admin não encontrada. Faça login no admin novamente.'
    )

  const r = await ctx.clients.vtexApi.validarToken(token)

  if (r?.authStatus !== 'Success')
    return negar('Sessão do admin inválida ou expirada. Faça login novamente.')

  ctx.state.userToken = token
  ctx.state.userEmail = r.user ?? ''

  await next()
}
