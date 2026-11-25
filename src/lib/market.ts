import type { MarketPrice, Product } from '../../shared/types.ts';
import { localISODate } from '../../shared/dates.ts';

/** Preços mais antigos que isso não entram na comparação (por padrão). */
export const MARKET_MAX_AGE_DAYS = 180;

export function marketCutoff(now = new Date()): string {
  return localISODate(new Date(now.getTime() - MARKET_MAX_AGE_DAYS * 864e5));
}

/**
 * Preços de concorrentes que valem para um tamanho: os registrados para aquele tamanho.
 * Preços sem tamanho ("geral") só valem quando o produto tem um único tamanho.
 */
export function marketEntriesFor(market: MarketPrice[], product: Product, variantId: number, onlyRecent = true): MarketPrice[] {
  const cutoff = marketCutoff();
  const single = product.variants.length === 1;
  return market.filter(
    (m) =>
      m.productId === product.id &&
      (m.variantId === variantId || (m.variantId === null && single)) &&
      (!onlyRecent || m.observedAt >= cutoff),
  );
}
