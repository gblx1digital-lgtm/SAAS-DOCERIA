import { describe, expect, it } from 'vitest';
import {
  competitivePrice, costPerBase, indexById, marketStats, pricing, recipeCost, roundUp, unitsForProfit, variantCost,
} from '../shared/calc.ts';
import { DEFAULT_SETTINGS, type Ingredient, type Recipe, type Settings } from '../shared/types.ts';

const ing = (id: number, name: string, unit: Ingredient['unit'], packageSize: number, totalPrice: number, category = 'Outros', packs = 1): Ingredient => ({
  id, name, category, supplier: '', unit, packageSize, packs, totalPrice, lastPurchaseDate: '2026-11-01', notes: '', createdAt: '', updatedAt: '',
});

const ingredients = [
  ing(1, 'Leite condensado', 'g', 395, 7.9),        // 0,02/g
  ing(2, 'Creme de leite', 'g', 200, 4),           // 0,02/g
  ing(3, 'Chocolate', 'kg', 1, 40),                 // 0,04/g
  ing(4, 'Manteiga', 'g', 500, 25),                 // 0,05/g
  ing(5, 'Forminha', 'un', 100, 10, 'Embalagens'),  // 0,10/un
  ing(6, 'Leite', 'l', 1, 60, 'Laticínios', 12),     // 12 L por 60 → 0,005/ml
];
const ingMap = indexById(ingredients);

const brigadeiro: Recipe = {
  id: 1, name: 'Brigadeiro', category: '', yieldQty: 25, yieldLabel: 'unidades', portions: 5, totalWeightG: 500,
  prepMinutes: 60, notes: '', createdAt: '', updatedAt: '',
  items: [
    { ingredientId: 1, quantity: 395, unit: 'g' },
    { ingredientId: 2, quantity: 100, unit: 'g' },
    { ingredientId: 3, quantity: 50, unit: 'g' },
    { ingredientId: 4, quantity: 20, unit: 'g' },
  ],
};

describe('ingredientes', () => {
  it('1 kg de chocolate por R$ 40 = R$ 0,04/g', () => {
    expect(costPerBase(ingredients[2])).toBeCloseTo(0.04, 10);
  });
  it('considera número de embalagens', () => {
    expect(costPerBase(ingredients[5])).toBeCloseTo(0.005, 10);
  });
});

describe('receitas', () => {
  it('custo do brigadeiro', () => {
    const c = recipeCost(brigadeiro, ingMap);
    // 395*0.02=7.90; 100*0.02=2; 50*0.04=2; 20*0.05=1 → 12.90
    expect(c.total).toBeCloseTo(12.9, 10);
    expect(c.perUnit).toBeCloseTo(0.516, 10);
    expect(c.perPortion).toBeCloseTo(2.58, 10);
    expect(c.perGram).toBeCloseTo(0.0258, 10);
  });
  it('aceita unidades compatíveis (kg em ingrediente em g)', () => {
    const c = recipeCost({ ...brigadeiro, items: [{ ingredientId: 3, quantity: 0.05, unit: 'kg' }] }, ingMap);
    expect(c.total).toBeCloseTo(2, 10);
  });
  it('rejeita unidade incompatível', () => {
    expect(() => recipeCost({ ...brigadeiro, items: [{ ingredientId: 3, quantity: 1, unit: 'ml' }] }, ingMap)).toThrow();
  });
  it('recalcula quando o preço do ingrediente muda (R$ 40 → R$ 48/kg)', () => {
    const updated = indexById(ingredients.map((i) => (i.id === 3 ? { ...i, totalPrice: 48 } : i)));
    expect(recipeCost(brigadeiro, updated).total).toBeCloseTo(13.3, 10);
  });
});

const settings: Settings = {
  ...DEFAULT_SETTINGS,
  laborMonthly: 3200, monthlyHours: 160,                    // R$ 20/h
  energyMonthly: 100, gasMonthly: 60, waterMonthly: 0,      // R$ 1/h
  fixedCosts: [{ name: 'Aluguel', monthly: 320 }],          // R$ 2/h
  wastePct: 10, avgFeePct: 3, taxPct: 7, targetMarginPct: 30, premiumMarginPct: 40, roundTo: 0,
};

describe('produto e precificação', () => {
  const variant = {
    extraMinutes: 0,
    components: [{ recipeId: 1, mode: 'unit' as const, quantity: 1 }],
    items: [{ ingredientId: 5, quantity: 1, unit: 'un' as const }],
  };
  const vc = variantCost(variant, { ingredients: ingMap, recipes: indexById([brigadeiro]), settings });

  it('composição do custo por unidade', () => {
    const b = vc.breakdown;
    expect(b.ingredients).toBeCloseTo(0.516, 10);
    expect(b.packaging).toBeCloseTo(0.1, 10);
    expect(b.waste).toBeCloseTo(0.0516, 10);
    expect(b.minutes).toBeCloseTo(2.4, 10);           // 60 min / 25
    expect(b.labor).toBeCloseTo(0.8, 10);             // 2.4/60*20
    expect(b.utilities).toBeCloseTo(0.04, 10);
    expect(b.fixed).toBeCloseTo(0.08, 10);
    expect(b.total).toBeCloseTo(1.5876, 10);
  });

  it('preços mínimo, recomendado e premium', () => {
    const p = pricing(vc.breakdown.total, settings);
    expect(p.minimum).toBeCloseTo(1.77, 2);           // 1.5876 / 0.90 = 1.764 → 1.77
    expect(p.recommended).toBeCloseTo(2.65, 2);       // 1.5876 / 0.60 = 2.646 → 2.65
    expect(p.premium).toBeCloseTo(3.18, 2);           // 1.5876 / 0.50 = 3.1752 → 3.18
    // Lucro no recomendado: 2.65*0.9 - 1.5876 = 0.7974
    expect(p.recommendedProfit!).toBeCloseTo(0.7974, 4);
  });

  it('margem do preço atual', () => {
    const p = pricing(10, settings, { salePrice: 20 });
    expect(p.current!.profit).toBeCloseTo(8, 10);     // 20*0.9 - 10
    expect(p.current!.marginPct).toBeCloseTo(40, 10);
  });

  it('erro quando taxas + margem ≥ 100%', () => {
    const p = pricing(10, { ...settings, targetMarginPct: 95 });
    expect(p.recommended).toBeNull();
    expect(p.error).toBeTruthy();
  });

  it('quantidade para lucro desejado', () => {
    expect(unitsForProfit(1000, 0.8)).toBe(1250);
    expect(unitsForProfit(1000, 3)).toBe(334);
    expect(unitsForProfit(1000, 0)).toBeNull();
  });

  it('componente por grama e por lote', () => {
    const g = variantCost({ extraMinutes: 0, items: [], components: [{ recipeId: 1, mode: 'gram', quantity: 250 }] },
      { ingredients: ingMap, recipes: indexById([brigadeiro]), settings: { ...settings, wastePct: 0, laborMonthly: 0, energyMonthly: 0, gasMonthly: 0, fixedCosts: [] } });
    expect(g.breakdown.total).toBeCloseTo(6.45, 10);
  });
});

describe('arredondamento', () => {
  it('arredonda para cima', () => {
    expect(roundUp(12.01, 0.5)).toBe(12.5);
    expect(roundUp(12.5, 0.5)).toBe(12.5);
    expect(roundUp(12.31, 0.1)).toBe(12.4);
    expect(roundUp(12.3, 0.1)).toBe(12.3);
    expect(roundUp(12.341, 0)).toBe(12.35);
    expect(roundUp(12.34, 0)).toBe(12.34);
    expect(roundUp(7.2, 1)).toBe(8);
  });
});

describe('mercado', () => {
  it('sem dados suficientes, não há comparação', () => {
    expect(marketStats([3, 4])).toBeNull();
  });
  it('estatísticas e preço competitivo', () => {
    const s = marketStats([3, 3.5, 4, 4.5, 5])!;
    expect(s.median).toBe(4);
    expect(s.p25).toBe(3.5);
    expect(s.p75).toBe(4.5);
    const p = pricing(1.5876, settings);
    const adv = competitivePrice(p, s, 0.5)!;
    expect(adv.price).toBe(3.5);                      // recomendado 2,65 < P25 → sobe até P25
    expect(adv.status).toBe('saudavel');
  });
  it('alerta quando custo está acima do mercado', () => {
    const s = marketStats([1, 1.2, 1.3])!;
    const adv = competitivePrice(pricing(1.5876, settings), s, 0)!;
    expect(adv.status).toBe('custo_acima_mercado');
    expect(adv.price).toBeGreaterThanOrEqual(1.77);
  });
  it('limita ao P75 quando o recomendado está caro e informa margem apertada', () => {
    const s = marketStats([2, 2.2, 2.4])!;
    const adv = competitivePrice(pricing(1.5876, settings), s, 0)!;
    expect(adv.price).toBeCloseTo(2.3, 2);
    expect(adv.status).toBe('margem_apertada');
  });
});

import { parseNum } from '../src/lib/format.ts';

describe('números digitados (padrão brasileiro)', () => {
  it('interpreta vírgula decimal e ponto de milhar', () => {
    expect(parseNum('12,50')).toBe(12.5);
    expect(parseNum('1.000')).toBe(1000);
    expect(parseNum('12.500')).toBe(12500);
    expect(parseNum('1.250,75')).toBe(1250.75);
    expect(parseNum('R$ 7,90')).toBe(7.9);
    expect(parseNum('0.395')).toBe(0.395);
    expect(parseNum('1.5')).toBe(1.5);
    expect(parseNum('395')).toBe(395);
    expect(parseNum('')).toBeNaN();
    expect(parseNum('abc')).toBeNaN();
    expect(parseNum('1,2,3')).toBeNaN();
  });
});
