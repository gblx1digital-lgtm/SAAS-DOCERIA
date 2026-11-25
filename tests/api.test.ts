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
