import express, { type NextFunction, type Request, type Response } from 'express';
import { z, ZodError } from 'zod';
import type { DB } from './db.ts';
import * as repo from './repo.ts';
import { CalcError, indexById, round2, safeVariantCost, costPerBase } from '../shared/calc.ts';
import {
  TX_CATEGORY_TYPE,
  type PaymentMethod,
  type Settings,
  type TxCategory,
} from '../shared/types.ts';
import { buildDashboard } from './dashboard.ts';

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
  lastPurchaseDate: isoDate,
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
  observedAt: isoDate,
  notes: text(500).default(''),
});

const paymentMethod = z.enum(['dinheiro', 'pix', 'debito', 'credito', 'outro']);

const txSchema = z.discriminatedUnion('category', [
  z.object({
    category: z.literal('venda'),
    date: isoDate,
    productId: id,
    variantId: id,
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

function parseId(req: Request): number {
  const r = id.safeParse(req.params.id);
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

type Handler = (req: Request, res: Response) => unknown;
const h = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = fn(req, res);
    if (!res.headersSent) res.json(out ?? { ok: true });
  } catch (e) {
    next(e);
  }
};

// ───────── Rotas ─────────

export function createApi(db: DB) {
  const r = express.Router();
  r.use(express.json({ limit: '1mb' }));

  r.get('/health', h(() => ({ ok: true })));

  // Configurações
  r.get('/settings', h(() => repo.getSettings(db)));
  r.put('/settings', h((req) => repo.saveSettings(db, settingsSchema.parse(req.body) as Settings)));

  // Ingredientes
  r.get('/ingredients', h(() => repo.listIngredients(db)));
  r.get('/ingredients/history', h(() => repo.allHistory(db)));
  r.get('/ingredients/:id/history', h((req) => repo.ingredientHistory(db, parseId(req))));
  r.post('/ingredients', h((req, res) => {
    res.status(201);
    return repo.createIngredient(db, ingredientSchema.parse(req.body));
  }));
  r.put('/ingredients/:id', h((req) => repo.updateIngredient(db, parseId(req), ingredientSchema.parse(req.body))));
  r.delete('/ingredients/:id', h((req) => repo.deleteIngredient(db, parseId(req))));

  // Receitas
  r.get('/recipes', h(() => repo.listRecipes(db)));
  r.post('/recipes', h((req, res) => {
    res.status(201);
    return repo.createRecipe(db, recipeSchema.parse(req.body) as repo.RecipeInput);
  }));
  r.put('/recipes/:id', h((req) => repo.updateRecipe(db, parseId(req), recipeSchema.parse(req.body) as repo.RecipeInput)));
  r.delete('/recipes/:id', h((req) => repo.deleteRecipe(db, parseId(req))));

  // Produtos
  r.get('/products', h(() => repo.listProducts(db)));
  r.post('/products', h((req, res) => {
    res.status(201);
    return repo.createProduct(db, productSchema.parse(req.body) as repo.ProductInput);
  }));
  r.put('/products/:id', h((req) => repo.updateProduct(db, parseId(req), productSchema.parse(req.body) as repo.ProductInput)));
  r.delete('/products/:id', h((req) => repo.deleteProduct(db, parseId(req))));

  // Mercado
  r.get('/market', h(() => repo.listMarket(db)));
  r.post('/market', h((req, res) => {
    res.status(201);
    return repo.createMarket(db, marketSchema.parse(req.body) as repo.MarketInput);
  }));
  r.delete('/market/:id', h((req) => repo.deleteMarket(db, parseId(req))));

  // Financeiro
  r.get('/transactions', h((req) => {
    const from = typeof req.query.from === 'string' ? isoDate.parse(req.query.from) : undefined;
    const to = typeof req.query.to === 'string' ? isoDate.parse(req.query.to) : undefined;
    return repo.listTransactions(db, from, to);
  }));

  const buildTx = (body: unknown, existingId?: number): repo.TxInput => {
    const t = txSchema.parse(body) as any;
    const category = t.category as TxCategory;
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
      ingredientId: null,
    };
    if (category === 'venda') {
      const product = repo.getProduct(db, t.productId);
      const variant = product.variants.find((v) => v.id === t.variantId);
      if (!variant) throw new repo.Conflict('Tamanho/versão não pertence a este produto.');
      const settings = repo.getSettings(db);
      let unitCost: number | null = null;
      const prev = existingId ? repo.getTransaction(db, existingId) : null;
      if (prev && prev.variantId === variant.id && prev.unitCost !== null) {
        unitCost = prev.unitCost; // mantém o custo histórico da venda
      } else {
        const { cost, error } = safeVariantCost(variant, calcCtx(db));
        if (error) throw new repo.Conflict(`Não foi possível calcular o custo do produto: ${error}`);
        unitCost = cost!.breakdown.total;
      }
      return {
        ...base,
        description: t.description || `${product.name} · ${variant.name}`,
        fee: t.fee ?? feeFor(t.paymentMethod, t.amount, settings),
        productId: product.id,
        variantId: variant.id,
        quantity: t.quantity,
        unitCost,
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

  const applyIngredientUpdate = (body: any, date: string, amount: number) => {
    if (body?.category !== 'compra_ingrediente' || !body.updateIngredient || !body.ingredientId) return;
    const ing = repo.getIngredient(db, Number(body.ingredientId));
    const u = txSchema.parse(body) as any;
    repo.updateIngredient(db, ing.id, {
      ...ing,
      totalPrice: amount,
      lastPurchaseDate: date > ing.lastPurchaseDate ? date : ing.lastPurchaseDate,
      packageSize: u.updateIngredient.packageSize,
      packs: u.updateIngredient.packs,
      unit: u.updateIngredient.unit,
    });
  };

  r.post('/transactions', h((req, res) => {
    const t = buildTx(req.body);
    applyIngredientUpdate(req.body, t.date, t.amount);
    res.status(201);
    return repo.createTransaction(db, t);
  }));
  r.put('/transactions/:id', h((req) => {
    const txId = parseId(req);
    const t = buildTx(req.body, txId);
    applyIngredientUpdate(req.body, t.date, t.amount);
    return repo.updateTransaction(db, txId, t);
  }));
  r.delete('/transactions/:id', h((req) => repo.deleteTransaction(db, parseId(req))));

  // Painel
  r.get('/dashboard', h((req) => {
    const from = isoDate.parse(req.query.from);
    const to = isoDate.parse(req.query.to);
    if (from > to) throw new repo.Conflict('A data inicial deve ser anterior à final.');
    const gran = z.enum(['day', 'week', 'month']).catch('day').parse(req.query.granularity);
    return buildDashboard(db, from, to, gran);
  }));

  // Exportação completa (backup)
  r.get('/export', h((_req, res) => {
    res.setHeader('Content-Disposition', `attachment; filename="doceria-backup-${new Date().toISOString().slice(0, 10)}.json"`);
    return {
      exportedAt: new Date().toISOString(),
      settings: repo.getSettings(db),
      ingredients: repo.listIngredients(db).map((i) => ({ ...i, costPerBase: costPerBase(i) })),
      priceHistory: repo.allHistory(db),
      recipes: repo.listRecipes(db),
      products: repo.listProducts(db),
      market: repo.listMarket(db),
      transactions: repo.listTransactions(db),
    };
  }));

  r.use((_req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

  // Tratamento centralizado de erros
  r.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      const issue = err.issues[0];
      return res.status(400).json({ error: issue?.message ?? 'Dados inválidos.', field: issue?.path.join('.'), issues: err.issues });
    }
    if (err instanceof repo.NotFound) return res.status(404).json({ error: err.message });
    if (err instanceof repo.Conflict || err instanceof CalcError) return res.status(409).json({ error: err.message });
    if (err instanceof SyntaxError) return res.status(400).json({ error: 'JSON inválido.' });
    const msg = err instanceof Error ? err.message : String(err);
    if (/FOREIGN KEY/i.test(msg)) return res.status(409).json({ error: 'Registro em uso por outro cadastro.' });
    console.error(err);
    res.status(500).json({ error: 'Erro interno. Tente novamente.' });
  });

  return r;
}
