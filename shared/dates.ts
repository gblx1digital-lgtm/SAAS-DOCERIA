/** Data AAAA-MM-DD no fuso do aparelho. */
export function localISODate(d: Date = new Date()): string {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/** Último dia aceito para datas de compra (hoje + 1, folga para fusos horários). */
export function latestAllowedDate(now: Date = new Date()): string {
  return localISODate(new Date(now.getTime() + 864e5));
}
