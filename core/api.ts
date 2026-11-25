import { z, ZodError } from 'zod';
import { tx, type DB } from './db.ts';
import * as repo from './repo.ts';
import { CalcError, indexById, round2, safeVariantCost } from '../shared/calc.ts';
import {
  TX_CATEGORY_TYPE,
  type PaymentMethod,
  type Settings,
  type TxCategory,
} from '../shared/types.ts';
import { buildDashboard } from './dashboard.ts';
import { latestAllowedDate } from '../shared/dates.ts';

// ───────── Validação ─────────

const text = (max = 120) => z.string().trim().max(max);
const required = (label: string, max = 120) =>
  z.string({ required_error: `${label} é obrigatório.` }).trim().min(1, `${label} é obrigatório.`).max(max);
const money = (label: string) =>
  z.coerce.number({ invalid_type_error: `${label} inválido.` }).finite().min(0, `${label} não pode ser negativo.`).max(1e9).transform(round2);
const positive = (label: string) =>
  z.coerce.number({ invalid_type_error: `${label} inválido.` }).finite().gt(0, `${label} deve ser maior que zero.`).max(1e9);
const pct = (label: string, max = 99) =>
  z.coerce.number({ invalid_type_error: `${label} inválido.` }).finite().min(0, `${label} não pode ser negativo.`).max(max, `${label} deve ser no máximo ${max}%.`);
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (use AAAA-MM-DD).')
  .refine((d) => !Number.isNaN(Date.parse(d + 'T00:00:00Z')), 'Data inválida.');
const pastDate = (label: string) =>
  isoDate.refine((d) => d <= latestAllowedDate(), `${label} não pode ser no futuro.`);
const unit = z.enum(['g', 'kg', 'ml', 'l', 'un'], { errorMap: () => ({ message: 'Unidade inválida.' }) });
const id = z.coerce.number().int().positive();
const nullablePositive = (label: string) =>
  z.preprocess((v) => (v === '' || v === undefined ? null : v), positive(label).nullable());

const lineSchema = z.object({ ingredientId: id, quantity: positive('Quantidade'), unit });

const ingredientSchema = z.object({
  name: required('Nome'),
  category: required('Categoria', 60),
  supplier: text().default(''),
  unit,
  packageSize: positive('Conteúdo da embalagem'),
  packs: positive('Quantidade de embalagens'),
  totalPrice: money('Preço'),
  lastPurchaseDate: pastDate('A data da compra'),
  notes: text(500).default(''),
});

const recipeSchema = z.object({
  name: required('Nome'),
  category: text(60).default(''),
  yieldQty: positive('Rendimento'),
  yieldLabel: text(30).default('unidades').transform((s) => s || 'unidades'),
  portions: nullablePositive('Porções'),
  totalWeightG: nullablePositive('Peso final'),
  prepMinutes: z.coerce.number().finite().min(0, 'Tempo inválido.').max(100000).default(0),
  notes: text(2000).default(''),
  items: z.array(lineSchema).min(1, 'Adicione pelo menos um ingrediente.').max(200),
});

const variantSchema = z.object({
  id: id.optional().nullable(),
  name: required('Nome do tamanho/versão', 60),
  salePrice: z.preprocess((v) => (v === '' || v === undefined ? null : v), money('Preço de venda').nullable()),
  targetMargin: z.preprocess((v) => (v === '' || v === undefined ? null : v), pct('Margem', 95).nullable()),
  extraMinutes: z.coerce.number().finite().min(0).max(100000).default(0),
  components: z
    .array(z.object({ recipeId: id, mode: z.enum(['batch', 'unit', 'gram']), quantity: positive('Quantidade da receita') }))
    .max(50),
  items: z.array(lineSchema).max(100),
});

const productSchema = z.object({
  name: required('Nome'),
  category: required('Categoria', 60),
  description: text(1000).default(''),
  active: z.boolean().default(true),
  variants: z
    .array(variantSchema)
    .min(1, 'Cadastre pelo menos um tamanho/versão.')
    .max(30)
    .refine((vs) => vs.every((v) => v.components.length + v.items.length > 0), 'Cada tamanho precisa de ao menos uma receita ou item.'),
});

const settingsSchema = z.object({
  businessName: text(80).default(''),
  city: text(80).default(''),
  laborMonthly: money('Pró-labore'),
  monthlyHours: z.coerce.number().finite().gt(0, 'Horas de produção por mês devem ser maiores que zero.').max(744, 'Um mês tem no máximo 744 horas.'),
  energyMonthly: money('Energia'),
  gasMonthly: money('Gás'),
  waterMonthly: money('Água'),
  fixedCosts: z.array(z.object({ name: required('Nome da despesa', 60), monthly: money('Valor mensal') })).max(50),
  wastePct: pct('Desperdício', 90),
  avgFeePct: pct('Taxa média'),
  feeDebitPct: pct('Taxa do débito'),
  feeCreditPct: pct('Taxa do crédito'),
  feePixPct: pct('Taxa do Pix'),
  taxPct: pct('Impostos'),
  targetMarginPct: pct('Margem desejada', 95),
  premiumMarginPct: pct('Margem premium', 95),
  roundTo: z.coerce.number().refine((v) => [0, 0.05, 0.1, 0.5, 1].includes(v), 'Arredondamento inválido.'),
  priceAlertPct: pct('Alerta de aumento', 1000),
}).superRefine((s, ctx) => {
  if (s.avgFeePct + s.taxPct + s.targetMarginPct >= 100)
    ctx.addIssue({ code: 'custom', path: ['targetMarginPct'], message: 'Taxas + impostos + margem devem somar menos de 100%.' });
  if (s.avgFeePct + s.taxPct + s.premiumMarginPct >= 100)
    ctx.addIssue({ code: 'custom', path: ['premiumMarginPct'], message: 'Taxas + impostos + margem premium devem somar menos de 100%.' });
});

const marketSchema = z.object({
  productId: id,
  variantId: z.preprocess((v) => (v === '' || v === undefined ? null : v), id.nullable()),
  competitor: required('Concorrente', 80),
  region: text(80).default(''),
  price: positive('Preço'),
  source: required('Fonte (onde o preço foi visto)', 300),
  observedAt: pastDate('A data em que viu o preço'),
  notes: text(500).default(''),
});

const paymentMethod = z.enum(['dinheiro', 'pix', 'debito', 'credito', 'outro']);

const txSchema = z.discriminatedUnion('category', [
  z.object({
    category: z.literal('venda'),
    date: isoDate,
    // Nulos só ao editar uma venda cujo produto/tamanho foi excluído (mantém o que foi gravado).
    productId: z.preprocess((v) => (v === '' || v === undefined ? null : v), id.nullable()),
    variantId: z.preprocess((v) => (v === '' || v === undefined ? null : v), id.nullable()),
    quantity: positive('Quantidade'),
    amount: money('Valor total'),
    paymentMethod,
    fee: z.preprocess((v) => (v === '' ? undefined : v), money('Taxa').optional()),
    description: text(200).default(''),
  }),
  z.object({
    category: z.literal('compra_ingrediente'),
    date: isoDate,
    amount: positive('Valor').transform(round2),
    description: text(200).default(''),
    ingredientId: z.preprocess((v) => (v === '' || v === undefined ? null : v), id.nullable()),
    /** Atualiza o preço do ingrediente com esta compra. */
    updateIngredient: z
      .object({ packageSize: positive('Conteúdo da embalagem'), packs: positive('Quantidade de embalagens'), unit })
      .nullable()
      .optional(),
    paymentMethod: paymentMethod.nullable().optional(),
  }),
  ...(['outra_entrada', 'despesa_fixa', 'despesa_variavel', 'outra_saida'] as const).map((c) =>
    z.object({
      category: z.literal(c),
      date: isoDate,
      amount: positive('Valor').transform(round2),
      description: required('Descrição', 200),
      paymentMethod: paymentMethod.nullable().optional(),
    }),
  ),
] as any);

// ───────── Helpers ─────────

/** Data de atualização que o formulário viu ao abrir (evita sobrescrever alteração feita em outra aba). */
const expectedOf = (body: unknown): string | undefined => {
  const v = (body as { expectedUpdatedAt?: unknown } | null)?.expectedUpdatedAt;
  return typeof v === 'string' ? v : undefined;
};

function parseId(raw: string | undefined): number {
  const r = id.safeParse(raw);
  if (!r.success) throw new repo.NotFound('Registro');
  return r.data;
}

function feeFor(method: PaymentMethod, amount: number, s: Settings): number {
  const pct = method === 'pix' ? s.feePixPct : method === 'debito' ? s.feeDebitPct : method === 'credito' ? s.feeCreditPct : 0;
  return round2((amount * pct) / 100);
}

function calcCtx(db: DB) {
  return {
    ingredients: indexById(repo.listIngredients(db)),
    recipes: indexById(repo.listRecipes(db)),
    settings: repo.getSettings(db),
  };
}

// ───────── Roteador ─────────

export type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface ApiRequest {
  method: Method;
  path: string;
  query?: Record<string, string>;
  body?: unknown;
}

export interface ApiResponse {
  status: number;
  body: unknown;
}

interface Ctx {
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
}

interface Route {
  method: Method;
  pattern: RegExp;
  keys: string[];
  status: number;
  handler: (c: Ctx) => unknown;
}

export function errorResponse(err: unknown): ApiResponse {
  if (err instanceof ZodError) {
    const issue = err.issues[0];
    return { status: 400, body: { error: issue?.message ?? 'Dados inválidos.', field: issue?.path.join('.'), issues: err.issues } };
  }
  if (err instanceof repo.NotFound) return { status: 404, body: { error: err.message } };
  if (err instanceof repo.Conflict || err instanceof CalcError) return { status: 409, body: { error: err.message } };
  const msg = err instanceof Error ? err.message : String(err);
  if (/FOREIGN KEY/i.test(msg)) return { status: 409, body: { error: 'Registro em uso por outro cadastro.' } };
  if (/UNIQUE constraint failed: index 'ingredients_name'/i.test(msg))
    return { status: 409, body: { error: 'Já existe um ingrediente com este nome.' } };
  console.error(err);
  return { status: 500, body: { error: 'Erro interno. Tente novamente.' } };
}

export function createApi(db: DB): (req: ApiRequest) => ApiResponse {
  const routes: Route[] = [];
  const add = (method: Method, path: string, handler: (c: Ctx) => unknown, status = 200) => {
    const keys: string[] = [];
    const pattern = new RegExp(
      '^' +
        path.replace(/:(\w+)/g, (_m, k: string) => {
          keys.push(k);
          return '([^/]+)';
        }) +
        '/?$',
    );
    routes.push({ method, pattern, keys, status, handler });
  };

  add('GET', '/health', () => ({ ok: true }));

  // Configurações
  add('GET', '/settings', () => repo.getSettings(db));
  add('PUT', '/settings', (c) => repo.saveSettings(db, settingsSchema.parse(c.body) as Settings));

  // Ingredientes
  add('GET', '/ingredients', () => repo.listIngredients(db));
  add('GET', '/ingredients/history', () => repo.allHistory(db));
  add('GET', '/ingredients/:id/history', (c) => repo.ingredientHistory(db, parseId(c.params.id)));
  add('POST', '/ingredients', (c) => repo.createIngredient(db, ingredientSchema.parse(c.body)), 201);
  add('PUT', '/ingredients/:id', (c) => repo.updateIngredient(db, parseId(c.params.id), ingredientSchema.parse(c.body), expectedOf(c.body)));
  add('DELETE', '/ingredients/:id', (c) => repo.deleteIngredient(db, parseId(c.params.id)));

  // Receitas
  add('GET', '/recipes', () => repo.listRecipes(db));
  add('POST', '/recipes', (c) => repo.createRecipe(db, recipeSchema.parse(c.body) as repo.RecipeInput), 201);
  add('PUT', '/recipes/:id', (c) => repo.updateRecipe(db, parseId(c.params.id), recipeSchema.parse(c.body) as repo.RecipeInput, expectedOf(c.body)));
  add('DELETE', '/recipes/:id', (c) => repo.deleteRecipe(db, parseId(c.params.id)));

  // Produtos
  add('GET', '/products', () => repo.listProducts(db));
  add('POST', '/products', (c) => repo.createProduct(db, productSchema.parse(c.body) as repo.ProductInput), 201);
  add('PUT', '/products/:id', (c) => repo.updateProduct(db, parseId(c.params.id), productSchema.parse(c.body) as repo.ProductInput, expectedOf(c.body)));
  add('DELETE', '/products/:id', (c) => repo.deleteProduct(db, parseId(c.params.id)));
  add('GET', '/products/:id/usage', (c) => repo.productUsage(db, parseId(c.params.id)));

  // Mercado
  add('GET', '/market', () => repo.listMarket(db));
  add('POST', '/market', (c) => repo.createMarket(db, marketSchema.parse(c.body) as repo.MarketInput), 201);
  add('DELETE', '/market/:id', (c) => repo.deleteMarket(db, parseId(c.params.id)));

  // Financeiro
  add('GET', '/transactions', (c) => {
    const from = c.query.from !== undefined ? isoDate.parse(c.query.from) : undefined;
    const to = c.query.to !== undefined ? isoDate.parse(c.query.to) : undefined;
    return repo.listTransactions(db, from, to);
  });

  const buildTx = (body: unknown, existingId?: number): repo.TxInput => {
    const t = txSchema.parse(body) as any;
    const category = t.category as TxCategory;
    const prev = existingId ? repo.getTransaction(db, existingId) : null;
    const base: repo.TxInput = {
      date: t.date,
      type: TX_CATEGORY_TYPE[category],
      category,
      description: t.description ?? '',
      amount: t.amount,
      fee: 0,
      paymentMethod: t.paymentMethod ?? null,
      productId: null,
      variantId: null,
      quantity: null,
      unitCost: null,
      unitMaterialCost: null,
      unitLaborCost: null,
      tax: null,
      ingredientId: null,
    };
    if (category === 'venda') {
      const settings = repo.getSettings(db);
      const fee = t.fee ?? feeFor(t.paymentMethod, t.amount, settings);
      if (fee > t.amount) throw new repo.Conflict('A taxa não pode ser maior que o valor da venda.');
      // Imposto com a alíquota da época da venda (ao editar) ou a atual (venda nova).
      const taxRate =
        prev && prev.category === 'venda' && prev.tax !== null && prev.amount > 0 ? prev.tax / prev.amount : settings.taxPct / 100;
      const tax = round2(t.amount * taxRate);

      if (t.productId === null || t.variantId === null) {
        // Venda cujo produto/tamanho foi excluído: mantém produto e custos gravados.
        if (!prev || prev.category !== 'venda' || prev.variantId !== null) throw new repo.Conflict('Selecione o produto vendido.');
        return {
          ...base,
          description: t.description || prev.description,
          fee,
          productId: prev.productId,
          quantity: t.quantity,
          unitCost: prev.unitCost,
          unitMaterialCost: prev.unitMaterialCost,
          unitLaborCost: prev.unitLaborCost,
          tax,
        };
      }

      const product = repo.getProduct(db, t.productId);
      const variant = product.variants.find((v) => v.id === t.variantId);
      if (!variant) throw new repo.Conflict('Tamanho/versão não pertence a este produto.');
      const parts = (b: { ingredients: number; packaging: number; waste: number; labor: number; total: number }) => ({
        unitCost: b.total,
        unitMaterialCost: b.ingredients + b.packaging + b.waste,
        unitLaborCost: b.labor,
      });
      let costs: { unitCost: number | null; unitMaterialCost: number | null; unitLaborCost: number | null };
      if (prev && prev.variantId === variant.id && prev.unitCost !== null) {
        // Mesma venda, mesmo produto: mantém os custos da época da venda.
        costs = { unitCost: prev.unitCost, unitMaterialCost: prev.unitMaterialCost, unitLaborCost: prev.unitLaborCost };
        if (costs.unitMaterialCost === null || costs.unitLaborCost === null) {
          // Vendas registradas antes desta versão: completa com a melhor estimativa atual.
          const { cost } = safeVariantCost(variant, calcCtx(db));
          if (cost) {
            const est = parts(cost.breakdown);
            costs.unitMaterialCost ??= est.unitMaterialCost;
            costs.unitLaborCost ??= est.unitLaborCost;
          }
        }
      } else {
        const { cost, error } = safeVariantCost(variant, calcCtx(db));
        if (error) throw new repo.Conflict(`Não foi possível calcular o custo do produto: ${error}`);
        costs = parts(cost!.breakdown);
      }
      return {
        ...base,
        description: t.description || `${product.name} · ${variant.name}`,
        fee,
        productId: product.id,
        variantId: variant.id,
        quantity: t.quantity,
        ...costs,
        tax,
      };
    }
    if (category === 'compra_ingrediente') {
      let description = base.description;
      if (t.ingredientId) {
        const ing = repo.getIngredient(db, t.ingredientId);
        description = description || `Compra: ${ing.name}`;
      } else if (!description) {
        throw new repo.Conflict('Informe o ingrediente ou uma descrição da compra.');
      }
      return { ...base, description, ingredientId: t.ingredientId };
    }
    return base;
  };

  /**
   * Compra com "atualizar o preço": entra no histórico do ingrediente ligada ao lançamento,
   * e o preço atual passa a ser o da compra mais recente (por data). Editar ou excluir o
   * lançamento desfaz esse efeito.
   */
  const applyPurchase = (body: unknown, txId: number, t: repo.TxInput) => {
    const parsed = txSchema.parse(body) as any;
    if (parsed.category !== 'compra_ingrediente' || !parsed.updateIngredient || !parsed.ingredientId) return;
    if (t.date > latestAllowedDate())
      throw new repo.Conflict('Para atualizar o preço do ingrediente, a data da compra não pode ser no futuro.');
    repo.linkPurchase(db, txId, parsed.ingredientId, {
      totalPrice: t.amount,
      packageSize: parsed.updateIngredient.packageSize,
      packs: parsed.updateIngredient.packs,
      unit: parsed.updateIngredient.unit,
      purchaseDate: t.date,
    });
  };

  add('POST', '/transactions', (c) => {
    const t = buildTx(c.body);
    const created = repo.createTransaction(db, t);
    applyPurchase(c.body, created.id, t);
    return repo.getTransaction(db, created.id);
  }, 201);
  add('PUT', '/transactions/:id', (c) => {
    const txId = parseId(c.params.id);
    const t = buildTx(c.body, txId);
    repo.unlinkPurchase(db, txId);
    repo.updateTransaction(db, txId, t);
    applyPurchase(c.body, txId, t);
    return repo.getTransaction(db, txId);
  });
  add('DELETE', '/transactions/:id', (c) => repo.deleteTransaction(db, parseId(c.params.id)));

  // Painel
  add('GET', '/dashboard', (c) => {
    const from = isoDate.parse(c.query.from);
    const to = isoDate.parse(c.query.to);
    if (from > to) throw new repo.Conflict('A data inicial deve ser anterior à final.');
    if (Date.parse(to) - Date.parse(from) > 10 * 366 * 864e5) throw new repo.Conflict('Escolha um período de até 10 anos.');
    const gran = z.enum(['day', 'week', 'month']).catch('day').parse(c.query.granularity);
    return buildDashboard(db, from, to, gran);
  });

  return function handle(req: ApiRequest): ApiResponse {
    const path = req.path.replace(/^\/api(?=\/)/, '');
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.pattern.exec(path);
      if (!m) continue;
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      const ctx: Ctx = { params, query: req.query ?? {}, body: req.body };
      try {
        // Toda alteração é atômica: ou grava tudo, ou nada.
        const out = req.method === 'GET' ? r.handler(ctx) : tx(db, () => r.handler(ctx));
        return { status: r.status, body: out ?? { ok: true } };
      } catch (e) {
        return errorResponse(e);
      }
    }
    return { status: 404, body: { error: 'Rota não encontrada.' } };
  };
}
