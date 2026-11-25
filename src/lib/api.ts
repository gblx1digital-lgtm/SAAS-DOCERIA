// Interface de dados usada pelas telas. Tudo roda localmente, no navegador.
import { call } from './db-client.ts';
import type { Method } from '../../core/api.ts';

export class ApiError extends Error {
  constructor(message: string, public status: number, public field?: string) {
    super(message);
  }
}

/** Cópia profunda via JSON: mantém o mesmo comportamento de uma API HTTP (sem objetos compartilhados). */
const clone = <T,>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

async function request<T>(method: Method, url: string, body?: unknown): Promise<T> {
  const u = new URL(url, 'http://local');
  const query: Record<string, string> = {};
  u.searchParams.forEach((v, k) => (query[k] = v));
  let res;
  try {
    res = await call({ method, path: u.pathname, query, body: clone(body) });
  } catch (e) {
    throw new ApiError(e instanceof Error ? e.message : 'Erro ao acessar os dados.', 0);
  }
  const data = clone(res.body) as any;
  if (res.status >= 400) throw new ApiError(data?.error ?? `Erro ${res.status}`, res.status, data?.field);
  return data as T;
}

export const api = {
  get: <T,>(url: string) => request<T>('GET', url),
  post: <T,>(url: string, body: unknown) => request<T>('POST', url, body),
  put: <T,>(url: string, body: unknown) => request<T>('PUT', url, body),
  del: <T = { ok: true },>(url: string) => request<T>('DELETE', url),
};
