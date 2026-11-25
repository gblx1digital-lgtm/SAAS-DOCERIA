import { beforeAll, describe, expect, it } from 'vitest';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { openDatabase, tx, InvalidBackupError, SCHEMA_VERSION, type SqlJsDB } from '../core/db.ts';
import { createApi, type Method } from '../core/api.ts';
import { backupBytesFrom, makeBackupJson } from '../core/backup.ts';

let SQL: SqlJsStatic;
let db: SqlJsDB;
let handle: ReturnType<typeof createApi>;

/** Mesma semântica do cliente do navegador: corpo e resposta passam por JSON. */
function call(method: Method, url: string, body?: unknown) {
  const u = new URL(url, 'http://local');
  const query: Record<string, string> = {};
  u.searchParams.forEach((v, k) => (query[k] = v));
  const r = handle({ method, path: u.pathname, query, body: body === undefined ? undefined : JSON.parse(JSON.stringify(body)) });
  return { status: r.status, body: JSON.parse(JSON.stringify(r.body ?? null)) };
}

const SETTINGS = {
  businessName: 'Teste', city: 'São Paulo', laborMonthly: 0, monthlyHours: 160, energyMonthly: 0, gasMonthly: 0, waterMonthly: 0,
  fixedCosts: [], wastePct: 0, avgFeePct: 0, feeDebitPct: 2, feeCreditPct: 4, feePixPct: 0, taxPct: 0,
  targetMarginPct: 30, premiumMarginPct: 40, roundTo: 0, priceAlertPct: 5,
};

let chocolateId: number, leiteId: number, recipeId: number, productId: number, variantId: number;

beforeAll(async () => {
  SQL = await initSqlJs();
  db = openDatabase(SQL, null);
  handle = createApi(db);
  expect(call('PUT', '/settings', SETTINGS).status).toBe(200);
});

describe('API local', () => {
  it('valida ingrediente', () => {
    const r = call('POST', '/ingredients', { name: '', unit: 'kg' });
    expect(r.status).toBe(400);
    expect(r.body.error).toBeTruthy();
  });

  it('cadastra ingredientes e impede nome repetido', () => {
    const c = call('POST', '/ingredients', {
      name: 'Chocolate', category: 'Chocolates e cacau', unit: 'kg', packageSize: 1, packs: 1, totalPrice: 40, lastPurchaseDate: '2026-10-01',
    });
    expect(c.status).toBe(201);
    chocolateId = c.body.id;
    const l = call('POST', '/ingredients', {
      name: 'Leite condensado', category: 'Laticínios', unit: 'g', packageSize: 395, packs: 2, totalPrice: 15.8, lastPurchaseDate: '2026-10-01',
    });
    expect(l.status).toBe(201);
    leiteId = l.body.id;
    const dup = call('POST', '/ingredients', {
      name: 'chocolate', category: 'Outros', unit: 'g', packageSize: 1, packs: 1, totalPrice: 1, lastPurchaseDate: '2026-10-01',
    });
    expect(dup.status).toBe(409);
  });

  it('cria receita e produto', () => {
    const r = call('POST', '/recipes', {
      name: 'Brigadeiro', yieldQty: 20, prepMinutes: 40,
      items: [{ ingredientId: leiteId, quantity: 395, unit: 'g' }, { ingredientId: chocolateId, quantity: 50, unit: 'g' }],
    });
    expect(r.status).toBe(201);
    recipeId = r.body.id;
    const p = call('POST', '/products', {
      name: 'Brigadeiro gourmet', category: 'Brigadeiros',
      variants: [{ name: 'Unidade', salePrice: 3, extraMinutes: 0, components: [{ recipeId, mode: 'unit', quantity: 1 }], items: [] }],
    });
    expect(p.status).toBe(201);
    productId = p.body.id;
    variantId = p.body.variants[0].id;
  });

  it('bloqueia exclusão de ingrediente e receita em uso', () => {
    expect(call('DELETE', `/ingredients/${chocolateId}`).status).toBe(409);
    expect(call('DELETE', `/recipes/${recipeId}`).status).toBe(409);
  });

  it('rejeita unidade incompatível na receita', () => {
    const r = call('POST', '/recipes', { name: 'X', yieldQty: 1, items: [{ ingredientId: chocolateId, quantity: 1, unit: 'ml' }] });
    expect(r.status).toBe(409);
  });

  it('registra venda com custo e taxa', () => {
    const s = call('POST', '/transactions', {
      category: 'venda', date: '2026-11-20', productId, variantId, quantity: 10, amount: 30, paymentMethod: 'credito',
    });
    expect(s.status).toBe(201);
    // custo/un = (7.9 + 2) / 20 = 0.495
    expect(s.body.unitCost).toBeCloseTo(0.495, 6);
    expect(s.body.fee).toBeCloseTo(1.2, 6);
  });

  it('rejeita taxa maior que a venda', () => {
    const s = call('POST', '/transactions', {
      category: 'venda', date: '2026-11-20', productId, variantId, quantity: 1, amount: 3, fee: 5, paymentMethod: 'credito',
    });
    expect(s.status).toBe(409);
  });

  it('compra de ingrediente atualiza preço e histórico', () => {
    const r = call('POST', '/transactions', {
      category: 'compra_ingrediente', date: '2026-11-21', amount: 48, ingredientId: chocolateId,
      updateIngredient: { packageSize: 1, packs: 1, unit: 'kg' },
    });
    expect(r.status).toBe(201);
    const h = call('GET', `/ingredients/${chocolateId}/history`);
    expect(h.body.length).toBe(2);
    expect(h.body[1].costPerBase).toBeCloseTo(0.048, 6);
    const ing = call('GET', '/ingredients').body.find((i: any) => i.id === chocolateId);
    expect(ing.totalPrice).toBe(48);
    expect(ing.lastPurchaseDate).toBe('2026-11-21');
  });

  it('compra antiga entra só no histórico, sem mudar o preço atual', () => {
    const r = call('POST', '/transactions', {
      category: 'compra_ingrediente', date: '2026-09-15', amount: 30, ingredientId: chocolateId,
      updateIngredient: { packageSize: 1, packs: 1, unit: 'kg' },
    });
    expect(r.status).toBe(201);
    const ing = call('GET', '/ingredients').body.find((i: any) => i.id === chocolateId);
    expect(ing.totalPrice).toBe(48);
    const h = call('GET', `/ingredients/${chocolateId}/history`).body;
    expect(h.length).toBe(3);
    expect(h[0].purchaseDate).toBe('2026-09-15'); // ordenado por data
    expect(h[2].costPerBase).toBeCloseTo(0.048, 6);
  });

  it('painel agrega e gera alerta de aumento', () => {
    const d = call('GET', '/dashboard?from=2026-11-01&to=2026-11-30&granularity=week');
    expect(d.status).toBe(200);
    expect(d.body.totals.salesRevenue).toBe(30);
    expect(d.body.totals.cogs).toBeCloseTo(4.95, 6);
    expect(d.body.totals.purchases).toBe(48);
    expect(d.body.totals.estimatedProfit).toBeCloseTo(30 - 1.2 - 4.95, 6);
    expect(d.body.alerts[0].changePct).toBeCloseTo(20, 6);
    expect(d.body.topSold[0].quantity).toBe(10);
  });

  it('painel valida datas', () => {
    expect(call('GET', '/dashboard?from=2026-11-30&to=2026-11-01').status).toBe(409);
    expect(call('GET', '/dashboard').status).toBe(400);
  });

  it('valida mercado (fonte obrigatória)', () => {
    expect(call('POST', '/market', { productId, competitor: 'X', price: 3, observedAt: '2026-11-01' }).status).toBe(400);
    expect(call('POST', '/market', { productId, variantId, competitor: 'X', price: 3, source: 'Cardápio no Instagram', observedAt: '2026-11-01' }).status).toBe(201);
  });

  it('rejeita configuração inválida', () => {
    expect(call('PUT', '/settings', { monthlyHours: 0 }).status).toBe(400);
    expect(call('PUT', '/settings', { ...SETTINGS, avgFeePct: 10, taxPct: 10, targetMarginPct: 80 }).status).toBe(400);
  });

  it('rota inexistente e id inválido', () => {
    expect(call('GET', '/nada').status).toBe(404);
    expect(call('DELETE', '/transactions/abc').status).toBe(404);
    expect(call('DELETE', '/transactions/99999').status).toBe(404);
  });

  it('edição de produto preserva o id do tamanho (histórico de vendas)', () => {
    const p = call('GET', '/products').body.find((x: any) => x.id === productId);
    const r = call('PUT', `/products/${productId}`, { ...p, name: 'Brigadeiro gourmet 2' });
    expect(r.status).toBe(200);
    expect(r.body.variants[0].id).toBe(variantId);
  });
});

describe('transações aninhadas', () => {
  it('desfaz só a parte interna que falhou', () => {
    db.exec('CREATE TABLE IF NOT EXISTS t_nested (v INTEGER)');
    tx(db, () => {
      db.prepare('INSERT INTO t_nested VALUES (1)').run();
      expect(() =>
        tx(db, () => {
          db.prepare('INSERT INTO t_nested VALUES (2)').run();
          throw new Error('falha');
        }),
      ).toThrow('falha');
    });
    const rows = db.prepare('SELECT v FROM t_nested').all().map((r) => r.v);
    expect(rows).toEqual([1]);
  });

  it('requisição com erro não grava nada', () => {
    const before = call('GET', '/products').body.length;
    const r = call('POST', '/products', {
      name: 'Inválido', category: 'Bolos',
      variants: [{ name: 'A', components: [{ recipeId: 999999, mode: 'unit', quantity: 1 }], items: [] }],
    });
    expect(r.status).toBe(409);
    expect(call('GET', '/products').body.length).toBe(before);
  });
});

describe('persistência e backup', () => {
  it('exporta e reabre com os mesmos dados', () => {
    const bytes = db.exportBytes();
    const copy = openDatabase(SQL, bytes);
    const api2 = createApi(copy);
    const a = handle({ method: 'GET', path: '/ingredients' }).body as any[];
    const b = api2({ method: 'GET', path: '/ingredients' }).body as any[];
    expect(b).toEqual(a);
    copy.close();
  });

  it('chaves estrangeiras continuam ativas depois de exportar', () => {
    db.exportBytes();
    expect(() => db.prepare('DELETE FROM ingredients WHERE id = ?').run(chocolateId)).toThrow(/FOREIGN KEY/);
  });

  it('backup em JSON ida e volta', () => {
    const bytes = db.exportBytes();
    const json = makeBackupJson(bytes, '2026-11-25T00:00:00Z');
    const back = backupBytesFrom(new TextEncoder().encode(json));
    expect(back).toEqual(bytes);
    const restored = openDatabase(SQL, back, { strict: true });
    expect(restored.prepare('SELECT COUNT(*) c FROM ingredients').get()?.c).toBe(2);
    restored.close();
  });

  it('aceita SQLite puro e rejeita arquivos estranhos', () => {
    const bytes = db.exportBytes();
    expect(backupBytesFrom(bytes)).toBe(bytes);
    expect(() => backupBytesFrom(new TextEncoder().encode('{"foo":1}'))).toThrow(InvalidBackupError);
    expect(() => backupBytesFrom(new TextEncoder().encode('não é json'))).toThrow(InvalidBackupError);
    expect(() => openDatabase(SQL, new Uint8Array(500), { strict: true })).toThrow(InvalidBackupError);
  });

  it('rejeita SQLite de outro sistema', () => {
    const other = new SQL.Database();
    other.exec('CREATE TABLE coisa (x)');
    const bytes = other.export();
    other.close();
    expect(() => openDatabase(SQL, bytes, { strict: true })).toThrow(InvalidBackupError);
  });

  it('rejeita dados de versão mais nova do esquema', () => {
    const newer = openDatabase(SQL, null);
    newer.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
    const bytes = newer.exportBytes();
    newer.close();
    expect(() => openDatabase(SQL, bytes)).toThrow(/versão mais nova/);
  });

  it('abrir o banco é idempotente (migração repetida)', () => {
    const bytes = db.exportBytes();
    const a = openDatabase(SQL, bytes);
    const again = openDatabase(SQL, a.exportBytes());
    expect(again.prepare('PRAGMA user_version').get()?.user_version).toBe(SCHEMA_VERSION);
    a.close();
    again.close();
  });
});

// ───────── Correções da revisão independente ─────────

describe('revisão: resultado, impostos e compras', () => {
  let h: ReturnType<typeof createApi>;
  let dbx: SqlJsDB;
  const c = (method: Method, url: string, body?: unknown) => {
    const u = new URL(url, 'http://local');
    const query: Record<string, string> = {};
    u.searchParams.forEach((v, k) => (query[k] = v));
    const r = h({ method, path: u.pathname, query, body: body === undefined ? undefined : JSON.parse(JSON.stringify(body)) });
    return { status: r.status, body: JSON.parse(JSON.stringify(r.body ?? null)) };
  };
  let ingId: number, prodId: number, unitV: number, boxV: number;

  beforeAll(() => {
    dbx = openDatabase(SQL, null);
    h = createApi(dbx);
    // R$ 16/h de mão de obra; R$ 4/h de despesas fixas (160 h/mês); imposto 6%
    expect(c('PUT', '/settings', { ...SETTINGS, laborMonthly: 2560, fixedCosts: [{ name: 'Aluguel', monthly: 640 }], taxPct: 6, feeCreditPct: 0 }).status).toBe(200);
    ingId = c('POST', '/ingredients', { name: 'Chocolate', category: 'Chocolates e cacau', unit: 'kg', packageSize: 1, packs: 1, totalPrice: 40, lastPurchaseDate: '2026-10-01' }).body.id;
    const r = c('POST', '/recipes', { name: 'Massa', yieldQty: 10, prepMinutes: 60, items: [{ ingredientId: ingId, quantity: 500, unit: 'g' }] }).body;
    const p = c('POST', '/products', {
      name: 'Doce', category: 'Docinhos',
      variants: [
        { name: 'Unidade', salePrice: 10, components: [{ recipeId: r.id, mode: 'unit', quantity: 1 }], items: [] },
        { name: 'Caixa', salePrice: 38, components: [{ recipeId: r.id, mode: 'unit', quantity: 4 }], items: [] },
      ],
    }).body;
    prodId = p.id;
    [unitV, boxV] = p.variants.map((v: any) => v.id);
  });

  it('lucro do período não desconta despesas fixas duas vezes (BL-1)', () => {
    // custo/un: ingrediente 2,00; mão de obra 6 min = 1,60; fixas 6 min = 0,40 → total 4,00
    const s = c('POST', '/transactions', { category: 'venda', date: '2026-11-10', productId: prodId, variantId: unitV, quantity: 10, amount: 100, paymentMethod: 'dinheiro' });
    expect(s.body.unitCost).toBeCloseTo(4, 6);
    expect(s.body.unitMaterialCost).toBeCloseTo(2, 6);
    expect(s.body.unitLaborCost).toBeCloseTo(1.6, 6);
    expect(s.body.tax).toBeCloseTo(6, 6);
    c('POST', '/transactions', { category: 'despesa_fixa', date: '2026-11-05', amount: 640, description: 'Aluguel' });
    const d = c('GET', '/dashboard?from=2026-11-01&to=2026-11-30&granularity=day').body;
    // 100 − 6 imposto − 20 ingredientes − 16 mão de obra − 640 aluguel lançado (fixas NÃO entram de novo)
    expect(d.totals.estimatedProfit).toBeCloseTo(100 - 6 - 20 - 16 - 640, 6);
    expect(d.totals.materials).toBeCloseTo(20, 6);
    expect(d.totals.labor).toBeCloseTo(16, 6);
    // lucro por produto usa o custo completo (igual à Precificação): 100 − 6 − 40
    expect(d.topProfitable[0].profit).toBeCloseTo(54, 6);
  });

  it('imposto fica com a alíquota da época da venda (BL-8)', () => {
    c('PUT', '/settings', { ...SETTINGS, laborMonthly: 2560, fixedCosts: [{ name: 'Aluguel', monthly: 640 }], taxPct: 15 });
    const d = c('GET', '/dashboard?from=2026-11-01&to=2026-11-30&granularity=day').body;
    expect(d.totals.taxes).toBeCloseTo(6, 6);
  });

  it('excluir ou corrigir uma compra refaz o preço do ingrediente (BL-5)', () => {
    const price = () => c('GET', '/ingredients').body.find((i: any) => i.id === ingId).totalPrice;
    const p1 = c('POST', '/transactions', { category: 'compra_ingrediente', date: '2026-11-12', amount: 480, ingredientId: ingId, updateIngredient: { packageSize: 1, packs: 1, unit: 'kg' } });
    expect(p1.status).toBe(201);
    expect(price()).toBe(480); // digitado errado
    expect(p1.body.purchase).toEqual({ packs: 1, packageSize: 1, unit: 'kg' });
    const fixed = c('PUT', `/transactions/${p1.body.id}`, { category: 'compra_ingrediente', date: '2026-11-12', amount: 48, ingredientId: ingId, updateIngredient: { packageSize: 1, packs: 1, unit: 'kg' } });
    expect(fixed.status).toBe(200);
    expect(price()).toBe(48);
    expect(c('DELETE', `/transactions/${p1.body.id}`).status).toBe(200);
    expect(price()).toBe(40); // volta ao preço anterior
    const hist = c('GET', `/ingredients/${ingId}/history`).body;
    expect(hist.length).toBe(1);
  });

  it('compra com data no futuro não trava o preço (BL-6)', () => {
    const r = c('POST', '/transactions', { category: 'compra_ingrediente', date: '2099-01-01', amount: 50, ingredientId: ingId, updateIngredient: { packageSize: 1, packs: 1, unit: 'kg' } });
    expect(r.status).toBe(409);
    const ing = c('GET', '/ingredients').body.find((i: any) => i.id === ingId);
    expect(c('PUT', `/ingredients/${ingId}`, { ...ing, lastPurchaseDate: '2099-01-01' }).status).toBe(400);
  });

  it('alerta de aumento só dispara quando o preço sobe acima do limite (BL-10)', () => {
    c('PUT', '/settings', { ...SETTINGS, priceAlertPct: 0 });
    c('POST', '/transactions', { category: 'compra_ingrediente', date: '2026-11-13', amount: 40, ingredientId: ingId, updateIngredient: { packageSize: 1, packs: 1, unit: 'kg' } });
    const d = c('GET', '/dashboard?from=2026-11-01&to=2026-11-30&granularity=day').body;
    expect(d.alerts.length).toBe(0);
  });

  it('editar venda de tamanho removido mantém produto e custo (BL-3)', () => {
    const sale = c('POST', '/transactions', { category: 'venda', date: '2026-11-14', productId: prodId, variantId: boxV, quantity: 1, amount: 38, paymentMethod: 'pix' }).body;
    const usage = c('GET', `/products/${prodId}/usage`).body;
    expect(usage.find((u: any) => u.variantId === boxV).sales).toBe(1);
    const p = c('GET', '/products').body.find((x: any) => x.id === prodId);
    expect(c('PUT', `/products/${prodId}`, { ...p, variants: p.variants.filter((v: any) => v.id !== boxV) }).status).toBe(200);
    const orphan = c('GET', '/transactions').body.find((t: any) => t.id === sale.id);
    expect(orphan.variantId).toBeNull();
    const edited = c('PUT', `/transactions/${sale.id}`, { category: 'venda', date: '2026-11-15', productId: null, variantId: null, quantity: 1, amount: 40, paymentMethod: 'pix' });
    expect(edited.status).toBe(200);
    expect(edited.body.unitCost).toBeCloseTo(sale.unitCost, 6);
    expect(edited.body.productId).toBe(prodId);
    expect(edited.body.description).toBe(sale.description);
    // venda normal não aceita produto vazio
    const normal = c('POST', '/transactions', { category: 'venda', date: '2026-11-14', productId: prodId, variantId: unitV, quantity: 1, amount: 10, paymentMethod: 'pix' }).body;
    expect(c('PUT', `/transactions/${normal.id}`, { category: 'venda', date: '2026-11-14', productId: null, variantId: null, quantity: 1, amount: 10, paymentMethod: 'pix' }).status).toBe(409);
  });

  it('não sobrescreve alteração feita em outra aba (UI-09)', () => {
    const ing = c('GET', '/ingredients').body.find((i: any) => i.id === ingId);
    expect(c('PUT', `/ingredients/${ingId}`, { ...ing, supplier: 'A', expectedUpdatedAt: '2000-01-01 00:00:00' }).status).toBe(409);
    expect(c('PUT', `/ingredients/${ingId}`, { ...ing, supplier: 'A', expectedUpdatedAt: ing.updatedAt }).status).toBe(200);
  });

  it('períodos longos: agrupamento automático e limite de 10 anos (BL-9)', () => {
    const d = c('GET', '/dashboard?from=2022-01-01&to=2026-11-30&granularity=day').body;
    expect(d.period.granularity).toBe('month');
    expect(d.series.length).toBe(59);
    expect(c('GET', '/dashboard?from=2001-01-01&to=2026-11-30&granularity=day').status).toBe(409);
  });
});

describe('migração do banco v1 → v2', () => {
  it('acrescenta as colunas novas sem perder dados', () => {
    const old = new SQL.Database();
    old.exec(`CREATE TABLE transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, type TEXT NOT NULL, category TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '', amount REAL NOT NULL, fee REAL NOT NULL DEFAULT 0, payment_method TEXT, product_id INTEGER,
      variant_id INTEGER, quantity REAL, unit_cost REAL, ingredient_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE ingredient_price_history (id INTEGER PRIMARY KEY AUTOINCREMENT, ingredient_id INTEGER NOT NULL, total_price REAL NOT NULL,
      package_size REAL NOT NULL, packs REAL NOT NULL, unit TEXT NOT NULL, cost_per_base REAL NOT NULL, purchase_date TEXT NOT NULL,
      recorded_at TEXT NOT NULL DEFAULT (datetime('now')));
      INSERT INTO transactions (date, type, category, description, amount) VALUES ('2026-10-01', 'saida', 'despesa_fixa', 'Luz', 90);
      PRAGMA user_version = 1;`);
    const bytes = old.export();
    old.close();
    const db2 = openDatabase(SQL, bytes);
    expect(db2.prepare('PRAGMA user_version').get()?.user_version).toBe(SCHEMA_VERSION);
    const cols = db2.prepare('PRAGMA table_info(transactions)').all().map((r) => r.name);
    expect(cols).toEqual(expect.arrayContaining(['unit_material_cost', 'unit_labor_cost', 'tax']));
    expect(db2.prepare('PRAGMA table_info(ingredient_price_history)').all().map((r) => r.name)).toContain('transaction_id');
    const api2 = createApi(db2);
    const list = api2({ method: 'GET', path: '/transactions' }).body as any[];
    expect(list[0].description).toBe('Luz');
    expect(list[0].tax).toBeNull();
    db2.close();
  });
});
