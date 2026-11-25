import type { DB } from './db.ts';
import * as repo from './repo.ts';
import { indexById, safeVariantCost, sum } from '../shared/calc.ts';
import type { BaseUnit } from '../shared/types.ts';
import { localISODate } from '../shared/dates.ts';

export type Granularity = 'day' | 'week' | 'month';


function bucketOf(date: string, g: Granularity): string {
  if (g === 'day') return date;
  if (g === 'month') return date.slice(0, 7);
  const d = new Date(date + 'T00:00:00Z');
  const dow = (d.getUTCDay() + 6) % 7; // segunda = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

function bucketsBetween(from: string, to: string, g: Granularity): string[] {
  const out: string[] = [];
  const d = new Date(bucketOf(from, g) + (g === 'month' ? '-01' : '') + 'T00:00:00Z');
  const end = new Date(to + 'T00:00:00Z');
  let guard = 0;
  while (d <= end && guard++ < 1000) {
    out.push(bucketOf(d.toISOString().slice(0, 10), g));
    if (g === 'day') d.setUTCDate(d.getUTCDate() + 1);
    else if (g === 'week') d.setUTCDate(d.getUTCDate() + 7);
    else d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}

/** Escolhe um agrupamento que caiba no gráfico (períodos longos passam para semana/mês). */
function effectiveGranularity(from: string, to: string, g: Granularity): Granularity {
  const days = (Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 864e5 + 1;
  if (g === 'day' && days > 120) g = 'week';
  if (g === 'week' && days > 7 * 104) g = 'month';
  return g;
}

export function buildDashboard(db: DB, from: string, to: string, requested: Granularity) {
  const gran = effectiveGranularity(from, to, requested);
  const txs = repo.listTransactions(db, from, to);
  const ingredients = repo.listIngredients(db);
  const recipes = repo.listRecipes(db);
  const products = repo.listProducts(db);
  const settings = repo.getSettings(db);
  const ctx = { ingredients: indexById(ingredients), recipes: indexById(recipes), settings };
  const variantById = new Map(products.flatMap((p) => p.variants.map((v) => [v.id, v] as const)));

  const sales = txs.filter((t) => t.category === 'venda');
  /**
   * Custos de cada venda, guardados no momento da venda:
   * - ingredientes + embalagens (+ desperdício) e mão de obra entram no resultado do período;
   * - contas e despesas fixas NÃO: no resultado elas contam pelo que foi lançado como despesa,
   *   para não serem descontadas duas vezes.
   * Vendas antigas sem esses valores usam a composição atual do produto como estimativa.
   */
  type Sale = (typeof sales)[number];
  const estimate = (t: Sale) => {
    const v = t.variantId ? variantById.get(t.variantId) : undefined;
    const { cost } = v ? safeVariantCost(v, ctx) : { cost: null };
    return cost?.breakdown ?? null;
  };
  const materialOf = (t: Sale): number => {
    if (t.unitMaterialCost !== null) return t.unitMaterialCost;
    const b = estimate(t);
    return b ? b.ingredients + b.packaging + b.waste : t.unitCost ?? 0;
  };
  const laborOf = (t: Sale): number => {
    if (t.unitLaborCost !== null) return t.unitLaborCost;
    if (t.unitMaterialCost === null && !estimate(t)) return 0; // custo antigo já inteiro em materialOf
    return estimate(t)?.labor ?? 0;
  };
  const fullCostOf = (t: Sale): number => t.unitCost ?? materialOf(t) + laborOf(t);
  const taxOf = (t: Sale) => t.tax ?? (t.amount * settings.taxPct) / 100;
  const salesRevenue = sum(sales.map((t) => t.amount));
  const otherIncome = sum(txs.filter((t) => t.category === 'outra_entrada').map((t) => t.amount));
  const fees = sum(sales.map((t) => t.fee));
  const materials = sum(sales.map((t) => materialOf(t) * (t.quantity ?? 0)));
  const labor = sum(sales.map((t) => laborOf(t) * (t.quantity ?? 0)));
  const cogs = materials + labor;
  const purchases = sum(txs.filter((t) => t.category === 'compra_ingrediente').map((t) => t.amount));
  const fixedExpenses = sum(txs.filter((t) => t.category === 'despesa_fixa').map((t) => t.amount));
  const variableExpenses = sum(txs.filter((t) => t.category === 'despesa_variavel').map((t) => t.amount));
  const otherExpenses = sum(txs.filter((t) => t.category === 'outra_saida').map((t) => t.amount));
  const expenses = fixedExpenses + variableExpenses + otherExpenses;
  const taxes = sum(sales.map(taxOf));
  const estimatedProfit = salesRevenue + otherIncome - fees - taxes - cogs - expenses;

  const cashIn = salesRevenue + otherIncome - fees;
  const cashOut = purchases + expenses;

  // Série temporal (fluxo de caixa)
  const series = new Map(
    bucketsBetween(from, to, gran).map((b) => [b, { bucket: b, entradas: 0, saidas: 0, saldo: 0 }]),
  );
  for (const t of txs) {
    const b = series.get(bucketOf(t.date, gran));
    if (!b) continue;
    if (t.type === 'entrada') b.entradas += t.amount - t.fee;
    else b.saidas += t.amount;
  }
  for (const b of series.values()) b.saldo = b.entradas - b.saidas;

  // Produtos
  const prodName = new Map<number, string>();
  for (const p of products) for (const v of p.variants) prodName.set(v.id, `${p.name} · ${v.name}`);
  const byVariant = new Map<string, { name: string; quantity: number; revenue: number; profit: number }>();
  for (const s of sales) {
    const key = String(s.variantId ?? s.description);
    const cur = byVariant.get(key) ?? {
      name: (s.variantId && prodName.get(s.variantId)) || s.description,
      quantity: 0,
      revenue: 0,
      profit: 0,
    };
    cur.quantity += s.quantity ?? 0;
    cur.revenue += s.amount;
    // Lucro por produto com o custo completo (igual à Precificação).
    cur.profit += s.amount - s.fee - taxOf(s) - fullCostOf(s) * (s.quantity ?? 0);
    byVariant.set(key, cur);
  }
  const productStats = [...byVariant.values()];

  // Ingredientes usados (estimado pela composição atual dos produtos vendidos)
  const usage = new Map<number, { baseQty: number; cost: number }>();
  for (const s of sales) {
    const v = s.variantId ? variantById.get(s.variantId) : undefined;
    if (!v) continue;
    const { cost } = safeVariantCost(v, ctx);
    if (!cost) continue;
    for (const [ingId, u] of cost.ingredientUsage) {
      const cur = usage.get(ingId) ?? { baseQty: 0, cost: 0 };
      usage.set(ingId, { baseQty: cur.baseQty + u.baseQty * (s.quantity ?? 0), cost: cur.cost + u.cost * (s.quantity ?? 0) });
    }
  }
  const ingById = indexById(ingredients);
  const baseOf = (u: string): BaseUnit => (u === 'kg' || u === 'g' ? 'g' : u === 'l' || u === 'ml' ? 'ml' : 'un');
  const ingredientsUsed = [...usage.entries()]
    .map(([id, u]) => ({ id, name: ingById.get(id)?.name ?? '—', baseUnit: baseOf(ingById.get(id)?.unit ?? 'un'), ...u }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 8);

  // Alertas de preço: última compra vs. anterior
  const history = repo.allHistory(db);
  const lastTwo = new Map<number, typeof history>();
  for (const h of history) {
    const arr = lastTwo.get(h.ingredientId) ?? [];
    arr.push(h);
    if (arr.length > 2) arr.shift();
    lastTwo.set(h.ingredientId, arr);
  }
  const alerts: { ingredientId: number; name: string; previous: number; current: number; changePct: number; baseUnit: BaseUnit; date: string }[] = [];
  for (const [ingId, arr] of lastTwo) {
    if (arr.length < 2) continue;
    const [prev, cur] = arr;
    if (prev.costPerBase <= 0) continue;
    const changePct = ((cur.costPerBase - prev.costPerBase) / prev.costPerBase) * 100;
    if (changePct > settings.priceAlertPct) {
      const ing = ingById.get(ingId);
      alerts.push({
        ingredientId: ingId,
        name: ing?.name ?? '—',
        previous: prev.costPerBase,
        current: cur.costPerBase,
        changePct,
        baseUnit: baseOf(cur.unit),
        date: cur.purchaseDate,
      });
    }
  }
  alerts.sort((a, b) => b.changePct - a.changePct);

  const today = localISODate(new Date());
  const staleLimit = localISODate(new Date(Date.now() - 90 * 864e5));
  const stale = ingredients
    .filter((i) => i.lastPurchaseDate < staleLimit)
    .map((i) => ({ id: i.id, name: i.name, lastPurchaseDate: i.lastPurchaseDate }));

  return {
    period: { from, to, granularity: gran, requestedGranularity: requested, today },
    totals: {
      salesRevenue,
      otherIncome,
      revenue: salesRevenue + otherIncome,
      fees,
      taxes,
      materials,
      labor,
      cogs,
      purchases,
      fixedExpenses,
      variableExpenses,
      otherExpenses,
      expenses,
      estimatedProfit,
      cashIn,
      cashOut,
      cashBalance: cashIn - cashOut,
      salesCount: sales.length,
      unitsSold: sum(sales.map((s) => s.quantity ?? 0)),
    },
    series: [...series.values()],
    topSold: [...productStats].sort((a, b) => b.quantity - a.quantity).slice(0, 6),
    topProfitable: [...productStats].sort((a, b) => b.profit - a.profit).slice(0, 6),
    ingredientsUsed,
    alerts,
    stale,
    counts: { ingredients: ingredients.length, recipes: recipes.length, products: products.length },
  };
}

export type Dashboard = ReturnType<typeof buildDashboard>;
