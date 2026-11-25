// Motor de cálculo: custos, rendimento e precificação.
// Usado tanto pelo servidor (snapshot de custo nas vendas, painel) quanto pela
// interface (pré-visualização ao vivo). Todos os valores em R$ e sem arredondar;
// arredondamento só na exibição ou nos preços sugeridos.

import {
  PACKAGING_CATEGORY,
  type BaseUnit,
  type Ingredient,
  type ItemLine,
  type Product,
  type ProductVariant,
  type Recipe,
  type Settings,
  type Unit,
  type VariantComponent,
} from './types.ts';

// ───────────────────────── Unidades ─────────────────────────

const UNIT_INFO: Record<Unit, { base: BaseUnit; factor: number }> = {
  g: { base: 'g', factor: 1 },
  kg: { base: 'g', factor: 1000 },
  ml: { base: 'ml', factor: 1 },
  l: { base: 'ml', factor: 1000 },
  un: { base: 'un', factor: 1 },
};

export function baseUnitOf(unit: Unit): BaseUnit {
  return UNIT_INFO[unit].base;
}

/** Unidades compatíveis com a unidade de compra do ingrediente. */
export function compatibleUnits(unit: Unit): Unit[] {
  const base = baseUnitOf(unit);
  return (Object.keys(UNIT_INFO) as Unit[]).filter((u) => UNIT_INFO[u].base === base);
}

export function areUnitsCompatible(a: Unit, b: Unit): boolean {
  return baseUnitOf(a) === baseUnitOf(b);
}

/** Converte uma quantidade para a unidade base (g, ml ou un). */
export function toBase(quantity: number, unit: Unit): number {
  return quantity * UNIT_INFO[unit].factor;
}

// ───────────────────────── Ingredientes ─────────────────────────

/** Quantidade total comprada na unidade base. */
export function purchasedBaseQty(i: Pick<Ingredient, 'packageSize' | 'packs' | 'unit'>): number {
  return toBase(i.packageSize * i.packs, i.unit);
}

/** Custo por grama / mililitro / unidade. Ex.: 1 kg por R$ 40 → R$ 0,04/g. */
export function costPerBase(i: Pick<Ingredient, 'packageSize' | 'packs' | 'unit' | 'totalPrice'>): number {
  const qty = purchasedBaseQty(i);
  if (!(qty > 0)) return 0;
  return i.totalPrice / qty;
}

export class CalcError extends Error {}

export interface LineCost {
  ingredientId: number;
  name: string;
  quantity: number;
  unit: Unit;
  baseQty: number;
  cost: number;
  isPackaging: boolean;
  missing: boolean;
}

export function lineCost(line: ItemLine, ingredients: Map<number, Ingredient>): LineCost {
  const ing = ingredients.get(line.ingredientId);
  if (!ing) {
    return {
      ingredientId: line.ingredientId,
      name: 'Ingrediente removido',
      quantity: line.quantity,
      unit: line.unit,
      baseQty: 0,
      cost: 0,
      isPackaging: false,
      missing: true,
    };
  }
  if (!areUnitsCompatible(line.unit, ing.unit)) {
    throw new CalcError(
      `Unidade "${line.unit}" incompatível com "${ing.name}" (comprado em ${ing.unit}).`,
    );
  }
  const baseQty = toBase(line.quantity, line.unit);
  return {
    ingredientId: ing.id,
    name: ing.name,
    quantity: line.quantity,
    unit: line.unit,
    baseQty,
    cost: baseQty * costPerBase(ing),
    isPackaging: ing.category === PACKAGING_CATEGORY,
    missing: false,
  };
}

// ───────────────────────── Receitas ─────────────────────────

export interface RecipeCost {
  lines: LineCost[];
  /** Custo de ingredientes (exceto embalagens). */
  food: number;
  packaging: number;
  total: number;
  perUnit: number;
  perPortion: number | null;
  perGram: number | null;
  hasMissing: boolean;
}

export function recipeCost(
  recipe: Pick<Recipe, 'items' | 'yieldQty' | 'portions' | 'totalWeightG'>,
  ingredients: Map<number, Ingredient>,
): RecipeCost {
  const lines = recipe.items.map((l) => lineCost(l, ingredients));
  const food = sum(lines.filter((l) => !l.isPackaging).map((l) => l.cost));
  const packaging = sum(lines.filter((l) => l.isPackaging).map((l) => l.cost));
  const total = food + packaging;
  return {
    lines,
    food,
    packaging,
    total,
    perUnit: recipe.yieldQty > 0 ? total / recipe.yieldQty : 0,
    perPortion: recipe.portions && recipe.portions > 0 ? total / recipe.portions : null,
    perGram: recipe.totalWeightG && recipe.totalWeightG > 0 ? total / recipe.totalWeightG : null,
    hasMissing: lines.some((l) => l.missing),
  };
}

/** Fração do lote da receita consumida por um componente do produto. */
export function componentFraction(
  c: VariantComponent,
  recipe: Pick<Recipe, 'yieldQty' | 'totalWeightG' | 'name'>,
): number {
  switch (c.mode) {
    case 'batch':
      return c.quantity;
    case 'unit':
      if (!(recipe.yieldQty > 0)) throw new CalcError(`A receita "${recipe.name}" não tem rendimento.`);
      return c.quantity / recipe.yieldQty;
    case 'gram':
      if (!recipe.totalWeightG || recipe.totalWeightG <= 0)
        throw new CalcError(`Informe o peso final da receita "${recipe.name}" para usá-la em gramas.`);
      return c.quantity / recipe.totalWeightG;
  }
}

// ───────────────────────── Produtos e precificação ─────────────────────────

export interface Rates {
  laborPerHour: number;
  utilitiesPerHour: number;
  fixedPerHour: number;
  fixedMonthly: number;
  utilitiesMonthly: number;
}

export function hourlyRates(s: Settings): Rates {
  const hours = s.monthlyHours > 0 ? s.monthlyHours : 0;
  const fixedMonthly = sum(s.fixedCosts.map((f) => f.monthly));
  const utilitiesMonthly = s.energyMonthly + s.gasMonthly + s.waterMonthly;
  return {
    laborPerHour: hours ? s.laborMonthly / hours : 0,
    utilitiesPerHour: hours ? utilitiesMonthly / hours : 0,
    fixedPerHour: hours ? fixedMonthly / hours : 0,
    fixedMonthly,
    utilitiesMonthly,
  };
}

export interface CostBreakdown {
  ingredients: number;
  packaging: number;
  waste: number;
  labor: number;
  utilities: number;
  fixed: number;
  total: number;
  minutes: number;
}

export interface VariantCost {
  breakdown: CostBreakdown;
  components: { recipeId: number; name: string; fraction: number; cost: number; minutes: number }[];
  items: LineCost[];
  /** Base quantity (g/ml/un) por ingrediente usada para 1 unidade do produto. */
  ingredientUsage: Map<number, { baseQty: number; cost: number }>;
  hasMissing: boolean;
}

export function variantCost(
  v: Pick<ProductVariant, 'components' | 'items' | 'extraMinutes'>,
  ctx: { ingredients: Map<number, Ingredient>; recipes: Map<number, Recipe>; settings: Settings },
): VariantCost {
  const { ingredients, recipes, settings } = ctx;
  let food = 0;
  let packaging = 0;
  let minutes = v.extraMinutes || 0;
  let hasMissing = false;
  const usage = new Map<number, { baseQty: number; cost: number }>();
  const addUsage = (id: number, baseQty: number, cost: number) => {
    const cur = usage.get(id) ?? { baseQty: 0, cost: 0 };
    usage.set(id, { baseQty: cur.baseQty + baseQty, cost: cur.cost + cost });
  };

  const components = v.components.map((c) => {
    const r = recipes.get(c.recipeId);
    if (!r) {
      hasMissing = true;
      return { recipeId: c.recipeId, name: 'Receita removida', fraction: 0, cost: 0, minutes: 0 };
    }
    const fraction = componentFraction(c, r);
    const rc = recipeCost(r, ingredients);
    if (rc.hasMissing) hasMissing = true;
    food += rc.food * fraction;
    packaging += rc.packaging * fraction;
    const m = r.prepMinutes * fraction;
    minutes += m;
    for (const l of rc.lines) if (!l.missing) addUsage(l.ingredientId, l.baseQty * fraction, l.cost * fraction);
    return { recipeId: r.id, name: r.name, fraction, cost: rc.total * fraction, minutes: m };
  });

  const items = v.items.map((l) => lineCost(l, ingredients));
  for (const l of items) {
    if (l.missing) hasMissing = true;
    else addUsage(l.ingredientId, l.baseQty, l.cost);
    if (l.isPackaging) packaging += l.cost;
    else food += l.cost;
  }

  const rates = hourlyRates(settings);
  const hours = minutes / 60;
  const waste = food * (settings.wastePct / 100);
  const labor = hours * rates.laborPerHour;
  const utilities = hours * rates.utilitiesPerHour;
  const fixed = hours * rates.fixedPerHour;
  const total = food + packaging + waste + labor + utilities + fixed;

  return {
    breakdown: { ingredients: food, packaging, waste, labor, utilities, fixed, total, minutes },
    components,
    items,
    ingredientUsage: usage,
    hasMissing,
  };
}

export function roundUp(value: number, step: number): number {
  if (!(step > 0)) return Math.ceil(round2(value * 100)) / 100;
  // Evita erros de ponto flutuante (ex.: 12.5000000001 → 13).
  return round2(Math.ceil(round2(value / step * 1e4) / 1e4 - 1e-9) * step);
}

export function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/** Preço que gera a margem líquida `marginPct` sobre o preço, após taxas e impostos. */
export function priceForMargin(cost: number, deductionsPct: number, marginPct: number): number | null {
  const divisor = 1 - (deductionsPct + marginPct) / 100;
  if (divisor <= 0) return null;
  return cost / divisor;
}

export interface Pricing {
  cost: number;
  deductionsPct: number;
  marginPct: number;
  premiumMarginPct: number;
  /** Preço que só cobre custos, taxas e impostos (lucro zero). */
  minimum: number | null;
  recommended: number | null;
  premium: number | null;
  /** Lucro líquido por unidade no preço recomendado. */
  recommendedProfit: number | null;
  /** Avaliação do meu preço atual, se houver. */
  current: null | { price: number; profit: number; marginPct: number; belowMinimum: boolean };
  error: string | null;
}

export function unitProfit(price: number, cost: number, deductionsPct: number): number {
  return price * (1 - deductionsPct / 100) - cost;
}

export function pricing(
  cost: number,
  settings: Settings,
  opts: { targetMargin?: number | null; salePrice?: number | null } = {},
): Pricing {
  const deductionsPct = settings.avgFeePct + settings.taxPct;
  const marginPct = opts.targetMargin ?? settings.targetMarginPct;
  const premiumMarginPct = Math.max(settings.premiumMarginPct, marginPct);
  let error: string | null = null;

  const minRaw = priceForMargin(cost, deductionsPct, 0);
  const recRaw = priceForMargin(cost, deductionsPct, marginPct);
  const preRaw = priceForMargin(cost, deductionsPct, premiumMarginPct);
  if (recRaw === null || preRaw === null) {
    error = 'Taxas + impostos + margem somam 100% ou mais. Reduza a margem ou as taxas.';
  }

  const minimum = minRaw === null ? null : roundUp(minRaw, 0);
  const recommended = recRaw === null ? null : roundUp(recRaw, settings.roundTo);
  const premium = preRaw === null ? null : roundUp(preRaw, settings.roundTo);

  let current: Pricing['current'] = null;
  if (opts.salePrice && opts.salePrice > 0) {
    const profit = unitProfit(opts.salePrice, cost, deductionsPct);
    current = {
      price: opts.salePrice,
      profit,
      marginPct: (profit / opts.salePrice) * 100,
      belowMinimum: profit < 0,
    };
  }

  return {
    cost,
    deductionsPct,
    marginPct,
    premiumMarginPct,
    minimum,
    recommended,
    premium,
    recommendedProfit: recommended === null ? null : unitProfit(recommended, cost, deductionsPct),
    current,
    error,
  };
}

/** Quantas unidades vender para atingir um lucro líquido. null se o lucro por unidade ≤ 0. */
export function unitsForProfit(targetProfit: number, profitPerUnit: number): number | null {
  if (!(profitPerUnit > 0)) return null;
  if (targetProfit <= 0) return 0;
  return Math.ceil(targetProfit / profitPerUnit - 1e-9);
}

// ───────────────────────── Mercado ─────────────────────────

export const MARKET_MIN_SAMPLES = 3;

export interface MarketStats {
  count: number;
  min: number;
  max: number;
  median: number;
  p25: number;
  p75: number;
  average: number;
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function marketStats(prices: number[]): MarketStats | null {
  const valid = prices.filter((p) => p > 0).sort((a, b) => a - b);
  if (valid.length < MARKET_MIN_SAMPLES) return null;
  return {
    count: valid.length,
    min: valid[0],
    max: valid[valid.length - 1],
    median: quantile(valid, 0.5),
    p25: quantile(valid, 0.25),
    p75: quantile(valid, 0.75),
    average: sum(valid) / valid.length,
  };
}

export type MarketPosition = 'abaixo' | 'dentro' | 'acima';

export interface CompetitiveAdvice {
  price: number;
  profit: number;
  marginPct: number;
  /** Situação do custo frente ao mercado. */
  status: 'saudavel' | 'margem_apertada' | 'custo_acima_mercado';
  message: string;
  myPricePosition: MarketPosition | null;
}

/**
 * Preço competitivo: parte do preço recomendado (custos + margem) e o mantém
 * dentro da faixa central do mercado (P25–P75), nunca abaixo do preço mínimo.
 */
export function competitivePrice(
  p: Pricing,
  stats: MarketStats,
  roundTo: number,
): CompetitiveAdvice | null {
  if (p.minimum === null || p.recommended === null) return null;
  const minimum = p.minimum;
  let price: number;
  let status: CompetitiveAdvice['status'];
  let message: string;

  if (minimum > stats.max) {
    price = roundUp(minimum, roundTo);
    status = 'custo_acima_mercado';
    message =
      'Seu preço mínimo já está acima do maior preço encontrado. Revise custos (ingredientes, tempo, embalagem) ou destaque o diferencial do produto.';
  } else {
    const lower = Math.max(minimum, stats.p25);
    const upper = Math.max(lower, stats.p75);
    const target = Math.min(Math.max(p.recommended, lower), upper);
    price = roundUp(target, roundTo);
    if (price > stats.max && minimum <= stats.max) price = Math.max(minimum, stats.max);
    const margin = (unitProfit(price, p.cost, p.deductionsPct) / price) * 100;
    if (margin + 1e-9 < p.marginPct) {
      status = 'margem_apertada';
      message = `No preço de mercado sua margem fica em ${margin.toFixed(1)}%, abaixo da meta de ${p.marginPct}%. O preço continua cobrindo custos.`;
    } else {
      status = 'saudavel';
      message =
        p.recommended < stats.p25
          ? 'Seu preço recomendado está abaixo do mercado; dá para cobrar um pouco mais sem ficar caro para o cliente.'
          : 'Preço dentro da faixa central do mercado e com a margem desejada.';
    }
  }

  const profit = unitProfit(price, p.cost, p.deductionsPct);
  let myPricePosition: MarketPosition | null = null;
  if (p.current) {
    myPricePosition =
      p.current.price < stats.p25 ? 'abaixo' : p.current.price > stats.p75 ? 'acima' : 'dentro';
  }
  return { price, profit, marginPct: (profit / price) * 100, status, message, myPricePosition };
}

// ───────────────────────── Utilidades ─────────────────────────

export function sum(values: number[]): number {
  let s = 0;
  for (const v of values) s += v;
  return s;
}

export function indexById<T extends { id: number }>(list: T[]): Map<number, T> {
  return new Map(list.map((x) => [x.id, x]));
}

export interface CalcContext {
  ingredients: Map<number, Ingredient>;
  recipes: Map<number, Recipe>;
  settings: Settings;
}

/** Calcula com segurança (erros viram mensagem em vez de quebrar a tela). */
export function safeVariantCost(
  v: Pick<ProductVariant, 'components' | 'items' | 'extraMinutes'>,
  ctx: CalcContext,
): { cost: VariantCost | null; error: string | null } {
  try {
    return { cost: variantCost(v, ctx), error: null };
  } catch (e) {
    return { cost: null, error: e instanceof Error ? e.message : String(e) };
  }
}

export function productsUsingRecipe(products: Product[], recipeId: number): Product[] {
  return products.filter((p) => p.variants.some((v) => v.components.some((c) => c.recipeId === recipeId)));
}
