import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/index.ts';

const { app } = createApp(':memory:');
const api = request(app);

let chocolateId: number, leiteId: number, recipeId: number, productId: number, variantId: number;

beforeAll(async () => {
  await api.put('/api/settings').send({
    businessName: 'Teste', city: 'São Paulo', laborMonthly: 0, monthlyHours: 160, energyMonthly: 0, gasMonthly: 0, waterMonthly: 0,
    fixedCosts: [], wastePct: 0, avgFeePct: 0, feeDebitPct: 2, feeCreditPct: 4, feePixPct: 0, taxPct: 0,
    targetMarginPct: 30, premiumMarginPct: 40, roundTo: 0, priceAlertPct: 5,
  }).expect(200);
});

describe('API', () => {
  it('valida ingrediente', async () => {
    const r = await api.post('/api/ingredients').send({ name: '', unit: 'kg' });
    expect(r.status).toBe(400);
    expect(r.body.error).toBeTruthy();
  });

  it('cadastra ingredientes', async () => {
    const c = await api.post('/api/ingredients').send({
      name: 'Chocolate', category: 'Chocolates e cacau', unit: 'kg', packageSize: 1, packs: 1, totalPrice: 40, lastPurchaseDate: '2026-10-01',
    }).expect(201);
    chocolateId = c.body.id;
    const l = await api.post('/api/ingredients').send({
      name: 'Leite condensado', category: 'Laticínios', unit: 'g', packageSize: 395, packs: 2, totalPrice: 15.8, lastPurchaseDate: '2026-10-01',
    }).expect(201);
    leiteId = l.body.id;
    const dup = await api.post('/api/ingredients').send({
      name: 'chocolate', category: 'Outros', unit: 'g', packageSize: 1, packs: 1, totalPrice: 1, lastPurchaseDate: '2026-10-01',
    });
    expect(dup.status).toBe(409);
  });

  it('cria receita e produto', async () => {
    const r = await api.post('/api/recipes').send({
      name: 'Brigadeiro', yieldQty: 20, prepMinutes: 40,
      items: [{ ingredientId: leiteId, quantity: 395, unit: 'g' }, { ingredientId: chocolateId, quantity: 50, unit: 'g' }],
    }).expect(201);
    recipeId = r.body.id;
    const p = await api.post('/api/products').send({
      name: 'Brigadeiro gourmet', category: 'Brigadeiros',
      variants: [{ name: 'Unidade', salePrice: 3, extraMinutes: 0, components: [{ recipeId, mode: 'unit', quantity: 1 }], items: [] }],
    }).expect(201);
    productId = p.body.id;
    variantId = p.body.variants[0].id;
  });

  it('bloqueia exclusão de ingrediente em uso', async () => {
    const r = await api.delete(`/api/ingredients/${chocolateId}`);
    expect(r.status).toBe(409);
  });

  it('registra venda com custo e taxa', async () => {
    const s = await api.post('/api/transactions').send({
      category: 'venda', date: '2026-11-20', productId, variantId, quantity: 10, amount: 30, paymentMethod: 'credito',
    }).expect(201);
    // custo/un = (7.9 + 2) / 20 = 0.495
    expect(s.body.unitCost).toBeCloseTo(0.495, 6);
    expect(s.body.fee).toBeCloseTo(1.2, 6);
  });

  it('compra de ingrediente atualiza preço e histórico', async () => {
    await api.post('/api/transactions').send({
      category: 'compra_ingrediente', date: '2026-11-21', amount: 48, ingredientId: chocolateId,
      updateIngredient: { packageSize: 1, packs: 1, unit: 'kg' },
    }).expect(201);
    const h = await api.get(`/api/ingredients/${chocolateId}/history`).expect(200);
    expect(h.body.length).toBe(2);
    expect(h.body[1].costPerBase).toBeCloseTo(0.048, 6);
  });

  it('painel agrega e gera alerta de aumento', async () => {
    const d = await api.get('/api/dashboard?from=2026-11-01&to=2026-11-30&granularity=week').expect(200);
    expect(d.body.totals.salesRevenue).toBe(30);
    expect(d.body.totals.cogs).toBeCloseTo(4.95, 6);
    expect(d.body.totals.purchases).toBe(48);
    expect(d.body.totals.estimatedProfit).toBeCloseTo(30 - 1.2 - 4.95, 6);
    expect(d.body.alerts[0].changePct).toBeCloseTo(20, 6);
    expect(d.body.topSold[0].quantity).toBe(10);
  });

  it('valida mercado', async () => {
    const r = await api.post('/api/market').send({ productId, competitor: 'X', price: 3, observedAt: '2026-11-01' });
    expect(r.status).toBe(400);
    await api.post('/api/market').send({ productId, variantId, competitor: 'X', price: 3, source: 'Cardápio no Instagram', observedAt: '2026-11-01' }).expect(201);
  });

  it('rejeita configuração inválida', async () => {
    const r = await api.put('/api/settings').send({ monthlyHours: 0 });
    expect(r.status).toBe(400);
  });
});
