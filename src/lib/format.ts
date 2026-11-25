import type { BaseUnit } from '../../shared/types.ts';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brlPrecise = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 4 });
const num = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

export const money = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : brl.format(v));
/** Até 4 casas: útil para custo por grama. */
export const moneyPrecise = (v: number | null | undefined) =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : brlPrecise.format(v);
export const number = (v: number | null | undefined, digits = 2) =>
  v === null || v === undefined || !Number.isFinite(v)
    ? '—'
    : new Intl.NumberFormat('pt-BR', { maximumFractionDigits: digits }).format(v);
export const pct = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : `${num.format(Number(v.toFixed(digits)))}%`;

export const date = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};

export const baseLabel: Record<BaseUnit, string> = { g: 'g', ml: 'ml', un: 'un' };

/** Formata quantidade em unidade base de forma legível (1.500 g → 1,5 kg). */
export function qtyBase(v: number, base: BaseUnit) {
  if (base === 'g' && v >= 1000) return `${number(v / 1000, 2)} kg`;
  if (base === 'ml' && v >= 1000) return `${number(v / 1000, 2)} L`;
  return `${number(v, 1)} ${base}`;
}

export const minutes = (m: number) => {
  if (!m) return '0 min';
  if (m < 60) return `${number(m, 1)} min`;
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  return r ? `${h} h ${r} min` : `${h} h`;
};

export function todayISO() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Converte texto digitado ("12,50") em número. Retorna NaN se inválido. */
export function parseNum(s: string | number | null | undefined): number {
  if (typeof s === 'number') return s;
  if (s === null || s === undefined) return NaN;
  const t = s.trim().replace(/\s/g, '').replace(/R\$/i, '');
  if (!t) return NaN;
  const normalized = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  return /^-?\d*\.?\d+$/.test(normalized) ? Number(normalized) : NaN;
}

/** Número → texto para campo editável (12.5 → "12,5"). */
export const toField = (v: number | null | undefined) =>
  v === null || v === undefined || !Number.isFinite(v) ? '' : String(v).replace('.', ',');
