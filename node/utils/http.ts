import type { IOResponse } from '@vtex/api'

export interface Resp<T = any> {
  status: number
  data: T
  headers: Record<string, any>
}

/** Equivalente ao muteHttpExceptions: nunca lança erro, devolve status + corpo + headers. */
export async function safe<T = any>(
  fn: () => Promise<IOResponse<T>>
): Promise<Resp<T>> {
  try {
    const r = await fn()

    return { status: r.status, data: r.data, headers: r.headers ?? {} }
  } catch (e) {
    if (e?.response) {
      return {
        status: e.response.status,
        data: e.response.data,
        headers: e.response.headers ?? {},
      }
    }

    return { status: 0, data: (e?.message ?? String(e)) as any, headers: {} }
  }
}

export const paraHttp = (url: string) => url.replace(/^https:\/\//i, 'http://')

/** Objeto → devolve igual; string JSON → parse; string não-JSON → undefined. */
export function tentarJson(d: unknown): any {
  if (typeof d !== 'string') return d
  try {
    return JSON.parse(d)
  } catch {
    return undefined
  }
}
