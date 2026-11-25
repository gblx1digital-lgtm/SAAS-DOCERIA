// Acesso a dados: converte linhas do SQLite nos tipos compartilhados.
import type { DB } from './db.ts';
import { tx } from './db.ts';
import { costPerBase } from '../shared/calc.ts';
import {
  DEFAULT_SETTINGS,
  type Ingredient,
  type ItemLine,
  type MarketPrice,
  type PriceHistoryEntry,
  type Product,
  type ProductVariant,
  type Recipe,
  type Settings,
  type Transaction,
  type Unit,
} from '../shared/types.ts';

type Row = Record<string, any>;

export class NotFound extends Error {
  constructor(what: string) {
    super(`${what} não encontrado(a).`);
  }
}
export class Conflict extends Error {}

// ───────── Settings ─────────

export function getSettings(db: DB): Settings {
  const row = db.prepare('SELECT data FROM settings WHERE id = 1').get() as Row | undefined;
  if (!row) return { ...DEFAULT_SETTINGS };
  return { ...DEFAULT_SETTINGS, ...JSON.parse(row.data) };
}

export function saveSettings(db: DB, s: Settings): Settings {
  db.prepare(
    'INSERT INTO settings (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data',
  ).run(JSON.stringify(s));
  return getSettings(db);
}

// ───────── Ingredients ─────────

const mapIngredient = (r: Row): Ingredient => ({
  id: r.id,
  name: r.name,
  category: r.category,
  supplier: r.supplier,
  unit: r.unit,
  packageSize: r.package_size,
  packs: r.packs,
  totalPrice: r.total_price,
  lastPurchaseDate: r.last_purchase_date,
  notes: r.notes,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export type IngredientInput = Omit<Ingredient, 'id' | 'createdAt' | 'updatedAt'>;

export function listIngredients(db: DB): Ingredient[] {
  return (db.prepare('SELECT * FROM ingredients ORDER BY name COLLATE NOCASE').all() as Row[]).map(mapIngredient);
}

export function getIngredient(db: DB, id: number): Ingredient {
  const r = db.prepare('SELECT * FROM ingredients WHERE id = ?').get(id) as Row | undefined;
  if (!r) throw new NotFound('Ingrediente');
  return mapIngredient(r);
}

function assertUniqueIngredientName(db: DB, name: string, exceptId?: number) {
  const r = db
    .prepare('SELECT id FROM ingredients WHERE lower(name) = lower(?) AND id != ?')
    .get(name, exceptId ?? -1) as Row | undefined;
  if (r) throw new Conflict(`Já existe um ingrediente chamado "${name}".`);
}

function recordHistory(db: DB, id: number, i: IngredientInput) {
  db.prepare(
    `INSERT INTO ingredient_price_history
     (ingredient_id, total_price, package_size, packs, unit, cost_per_base, purchase_date)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, i.totalPrice, i.packageSize, i.packs, i.unit, costPerBase(i), i.lastPurchaseDate);
}

export function createIngredient(db: DB, i: IngredientInput): Ingredient {
  assertUniqueIngredientName(db, i.name);
  return tx(db, () => {
    const res = db
      .prepare(
        `INSERT INTO ingredients (name, category, supplier, unit, package_size, packs, total_price, last_purchase_date, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(i.name, i.category, i.supplier, i.unit, i.packageSize, i.packs, i.totalPrice, i.lastPurchaseDate, i.notes);
    const id = Number(res.lastInsertRowid);
    recordHistory(db, id, i);
    return getIngredient(db, id);
  });
}

function assertUnitChangeAllowed(db: DB, id: number, newUnit: Unit, oldUnit: Unit) {
  const base = (u: string) => (u === 'kg' || u === 'g' ? 'g' : u === 'l' || u === 'ml' ? 'ml' : 'un');
  if (base(newUnit) === base(oldUnit)) return;
  const used =
    (db.prepare('SELECT COUNT(*) c FROM recipe_items WHERE ingredient_id = ?').get(id) as Row).c +
    (db.prepare('SELECT COUNT(*) c FROM variant_items WHERE ingredient_id = ?').get(id) as Row).c;
  if (used > 0)
    throw new Conflict(
      'Este ingrediente já é usado em receitas/produtos com outra unidade de medida. Ajuste-os antes de trocar entre peso, volume e unidade.',
    );
}

export function updateIngredient(db: DB, id: number, i: IngredientInput): Ingredient {
  const old = getIngredient(db, id);
  assertUniqueIngredientName(db, i.name, id);
  assertUnitChangeAllowed(db, id, i.unit, old.unit);
  return tx(db, () => {
    db.prepare(
      `UPDATE ingredients SET name=?, category=?, supplier=?, unit=?, package_size=?, packs=?, total_price=?,
       last_purchase_date=?, notes=?, updated_at=datetime('now') WHERE id=?`,
    ).run(i.name, i.category, i.supplier, i.unit, i.packageSize, i.packs, i.totalPrice, i.lastPurchaseDate, i.notes, id);
    const priceChanged =
      old.totalPrice !== i.totalPrice ||
      old.packageSize !== i.packageSize ||
      old.packs !== i.packs ||
      old.unit !== i.unit ||
      old.lastPurchaseDate !== i.lastPurchaseDate;
    if (priceChanged) recordHistory(db, id, i);
    return getIngredient(db, id);
  });
}

export function deleteIngredient(db: DB, id: number) {
  getIngredient(db, id);
  const recipes = db
    .prepare(
      'SELECT DISTINCT r.name FROM recipe_items ri JOIN recipes r ON r.id = ri.recipe_id WHERE ri.ingredient_id = ?',
    )
    .all(id) as Row[];
  const products = db
    .prepare(
      `SELECT DISTINCT p.name FROM variant_items vi JOIN product_variants v ON v.id = vi.variant_id
       JOIN products p ON p.id = v.product_id WHERE vi.ingredient_id = ?`,
    )
    .all(id) as Row[];
  const users = [...recipes, ...products].map((r) => r.name);
  if (users.length)
    throw new Conflict(`Não é possível excluir: usado em ${users.join(', ')}. Remova-o dessas receitas/produtos primeiro.`);
  db.prepare('DELETE FROM ingredients WHERE id = ?').run(id);
}

const mapHistory = (r: Row): PriceHistoryEntry => ({
  id: r.id,
  ingredientId: r.ingredient_id,
  totalPrice: r.total_price,
  packageSize: r.package_size,
  packs: r.packs,
  unit: r.unit,
  costPerBase: r.cost_per_base,
  purchaseDate: r.purchase_date,
  recordedAt: r.recorded_at,
});

export function ingredientHistory(db: DB, id: number): PriceHistoryEntry[] {
  getIngredient(db, id);
  return (
    db.prepare('SELECT * FROM ingredient_price_history WHERE ingredient_id = ? ORDER BY purchase_date, id').all(id) as Row[]
  ).map(mapHistory);
}

export function allHistory(db: DB): PriceHistoryEntry[] {
  return (db.prepare('SELECT * FROM ingredient_price_history ORDER BY ingredient_id, purchase_date, id').all() as Row[]).map(
    mapHistory,
  );
}

// ───────── Recipes ─────────

export type RecipeInput = Omit<Recipe, 'id' | 'createdAt' | 'updatedAt'>;

const mapLine = (r: Row): ItemLine => ({ id: r.id, ingredientId: r.ingredient_id, quantity: r.quantity, unit: r.unit });

export function listRecipes(db: DB): Recipe[] {
  const items = db.prepare('SELECT * FROM recipe_items ORDER BY recipe_id, position, id').all() as Row[];
  const byRecipe = new Map<number, ItemLine[]>();
  for (const it of items) {
    const arr = byRecipe.get(it.recipe_id) ?? [];
    arr.push(mapLine(it));
    byRecipe.set(it.recipe_id, arr);
  }
  return (db.prepare('SELECT * FROM recipes ORDER BY name COLLATE NOCASE').all() as Row[]).map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category,
    yieldQty: r.yield_qty,
    yieldLabel: r.yield_label,
    portions: r.portions,
    totalWeightG: r.total_weight_g,
    prepMinutes: r.prep_minutes,
    notes: r.notes,
    items: byRecipe.get(r.id) ?? [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export function getRecipe(db: DB, id: number): Recipe {
  const r = listRecipes(db).find((x) => x.id === id);
  if (!r) throw new NotFound('Receita');
  return r;
}

function assertIngredientsExist(db: DB, lines: ItemLine[]) {
  for (const l of lines) {
    const ing = db.prepare('SELECT unit, name FROM ingredients WHERE id = ?').get(l.ingredientId) as Row | undefined;
    if (!ing) throw new Conflict(`Ingrediente #${l.ingredientId} não existe mais.`);
    const base = (u: string) => (u === 'kg' || u === 'g' ? 'g' : u === 'l' || u === 'ml' ? 'ml' : 'un');
    if (base(ing.unit) !== base(l.unit))
      throw new Conflict(`Unidade "${l.unit}" incompatível com "${ing.name}" (comprado em ${ing.unit}).`);
  }
}

function writeRecipeItems(db: DB, recipeId: number, items: ItemLine[]) {
  db.prepare('DELETE FROM recipe_items WHERE recipe_id = ?').run(recipeId);
  const ins = db.prepare(
    'INSERT INTO recipe_items (recipe_id, ingredient_id, quantity, unit, position) VALUES (?, ?, ?, ?, ?)',
  );
  items.forEach((l, i) => ins.run(recipeId, l.ingredientId, l.quantity, l.unit, i));
}

export function createRecipe(db: DB, r: RecipeInput): Recipe {
  assertIngredientsExist(db, r.items);
  return tx(db, () => {
    const res = db
      .prepare(
        `INSERT INTO recipes (name, category, yield_qty, yield_label, portions, total_weight_g, prep_minutes, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(r.name, r.category, r.yieldQty, r.yieldLabel, r.portions, r.totalWeightG, r.prepMinutes, r.notes);
    const id = Number(res.lastInsertRowid);
    writeRecipeItems(db, id, r.items);
    return getRecipe(db, id);
  });
}

export function updateRecipe(db: DB, id: number, r: RecipeInput): Recipe {
  getRecipe(db, id);
  assertIngredientsExist(db, r.items);
  if (!r.totalWeightG) {
    const n = (db.prepare("SELECT COUNT(*) c FROM variant_components WHERE recipe_id = ? AND mode = 'gram'").get(id) as Row).c;
    if (n > 0) throw new Conflict('Esta receita é usada em gramas por algum produto; o peso final é obrigatório.');
  }
  return tx(db, () => {
    db.prepare(
      `UPDATE recipes SET name=?, category=?, yield_qty=?, yield_label=?, portions=?, total_weight_g=?, prep_minutes=?,
       notes=?, updated_at=datetime('now') WHERE id=?`,
    ).run(r.name, r.category, r.yieldQty, r.yieldLabel, r.portions, r.totalWeightG, r.prepMinutes, r.notes, id);
    writeRecipeItems(db, id, r.items);
    return getRecipe(db, id);
  });
}

export function deleteRecipe(db: DB, id: number) {
  getRecipe(db, id);
  const users = db
    .prepare(
      `SELECT DISTINCT p.name FROM variant_components c JOIN product_variants v ON v.id = c.variant_id
       JOIN products p ON p.id = v.product_id WHERE c.recipe_id = ?`,
    )
    .all(id) as Row[];
  if (users.length)
    throw new Conflict(`Não é possível excluir: usada nos produtos ${users.map((u) => u.name).join(', ')}.`);
  db.prepare('DELETE FROM recipes WHERE id = ?').run(id);
}

// ───────── Products ─────────

export type ProductInput = Omit<Product, 'id' | 'createdAt' | 'updatedAt' | 'variants'> & {
  variants: ProductVariant[];
};

export function listProducts(db: DB): Product[] {
  const comps = db.prepare('SELECT * FROM variant_components ORDER BY position, id').all() as Row[];
  const items = db.prepare('SELECT * FROM variant_items ORDER BY position, id').all() as Row[];
  const variants = db.prepare('SELECT * FROM product_variants ORDER BY position, id').all() as Row[];
  const group = <T,>(rows: Row[], key: string, map: (r: Row) => T) => {
    const m = new Map<number, T[]>();
    for (const r of rows) {
      const a = m.get(r[key]) ?? [];
      a.push(map(r));
      m.set(r[key], a);
    }
    return m;
  };
  const compBy = group(comps, 'variant_id', (r) => ({ id: r.id, recipeId: r.recipe_id, mode: r.mode, quantity: r.quantity }));
  const itemBy = group(items, 'variant_id', mapLine);
  const varBy = group(variants, 'product_id', (r) => ({
    id: r.id as number,
    name: r.name,
    salePrice: r.sale_price,
    targetMargin: r.target_margin,
    extraMinutes: r.extra_minutes,
    components: compBy.get(r.id) ?? [],
    items: itemBy.get(r.id) ?? [],
  }));
  return (db.prepare('SELECT * FROM products ORDER BY name COLLATE NOCASE').all() as Row[]).map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category,
    description: r.description,
    active: !!r.active,
    variants: varBy.get(r.id) ?? [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export function getProduct(db: DB, id: number): Product {
  const p = listProducts(db).find((x) => x.id === id);
  if (!p) throw new NotFound('Produto');
  return p;
}

function validateProductRefs(db: DB, p: ProductInput) {
  for (const v of p.variants) {
    assertIngredientsExist(db, v.items);
    for (const c of v.components) {
      const r = db.prepare('SELECT name, total_weight_g FROM recipes WHERE id = ?').get(c.recipeId) as Row | undefined;
      if (!r) throw new Conflict(`Receita #${c.recipeId} não existe mais.`);
      if (c.mode === 'gram' && !r.total_weight_g)
        throw new Conflict(`Informe o peso final da receita "${r.name}" para usá-la em gramas.`);
    }
  }
}

function writeVariants(db: DB, productId: number, variants: ProductVariant[]) {
  const existing = new Set(
    (db.prepare('SELECT id FROM product_variants WHERE product_id = ?').all(productId) as Row[]).map((r) => r.id as number),
  );
  const keep = new Set<number>();
  const insV = db.prepare(
    'INSERT INTO product_variants (product_id, name, sale_price, target_margin, extra_minutes, position) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const updV = db.prepare(
    'UPDATE product_variants SET name=?, sale_price=?, target_margin=?, extra_minutes=?, position=? WHERE id=? AND product_id=?',
  );
  const insC = db.prepare('INSERT INTO variant_components (variant_id, recipe_id, mode, quantity, position) VALUES (?, ?, ?, ?, ?)');
  const insI = db.prepare('INSERT INTO variant_items (variant_id, ingredient_id, quantity, unit, position) VALUES (?, ?, ?, ?, ?)');

  variants.forEach((v, idx) => {
    let vid: number;
    // Mantém o id da variante para preservar histórico de vendas e preços de mercado.
    if (v.id && existing.has(v.id)) {
      vid = v.id;
      updV.run(v.name, v.salePrice, v.targetMargin, v.extraMinutes, idx, vid, productId);
    } else {
      vid = Number(insV.run(productId, v.name, v.salePrice, v.targetMargin, v.extraMinutes, idx).lastInsertRowid);
    }
    keep.add(vid);
    db.prepare('DELETE FROM variant_components WHERE variant_id = ?').run(vid);
    db.prepare('DELETE FROM variant_items WHERE variant_id = ?').run(vid);
    v.components.forEach((c, i) => insC.run(vid, c.recipeId, c.mode, c.quantity, i));
    v.items.forEach((l, i) => insI.run(vid, l.ingredientId, l.quantity, l.unit, i));
  });
  for (const id of existing) if (!keep.has(id)) db.prepare('DELETE FROM product_variants WHERE id = ?').run(id);
}

export function createProduct(db: DB, p: ProductInput): Product {
  validateProductRefs(db, p);
  return tx(db, () => {
    const res = db
      .prepare('INSERT INTO products (name, category, description, active) VALUES (?, ?, ?, ?)')
      .run(p.name, p.category, p.description, p.active ? 1 : 0);
    const id = Number(res.lastInsertRowid);
    writeVariants(db, id, p.variants);
    return getProduct(db, id);
  });
}

export function updateProduct(db: DB, id: number, p: ProductInput): Product {
  getProduct(db, id);
  validateProductRefs(db, p);
  return tx(db, () => {
    db.prepare(
      "UPDATE products SET name=?, category=?, description=?, active=?, updated_at=datetime('now') WHERE id=?",
    ).run(p.name, p.category, p.description, p.active ? 1 : 0, id);
    writeVariants(db, id, p.variants);
    return getProduct(db, id);
  });
}

export function deleteProduct(db: DB, id: number) {
  getProduct(db, id);
  db.prepare('DELETE FROM products WHERE id = ?').run(id);
}

// ───────── Market ─────────

const mapMarket = (r: Row): MarketPrice => ({
  id: r.id,
  productId: r.product_id,
  variantId: r.variant_id,
  competitor: r.competitor,
  region: r.region,
  price: r.price,
  source: r.source,
  observedAt: r.observed_at,
  notes: r.notes,
  createdAt: r.created_at,
});

export type MarketInput = Omit<MarketPrice, 'id' | 'createdAt'>;

export function listMarket(db: DB): MarketPrice[] {
  return (db.prepare('SELECT * FROM market_prices ORDER BY observed_at DESC, id DESC').all() as Row[]).map(mapMarket);
}

export function createMarket(db: DB, m: MarketInput): MarketPrice {
  const p = getProduct(db, m.productId);
  if (m.variantId !== null && !p.variants.some((v) => v.id === m.variantId))
    throw new Conflict('Tamanho/versão não pertence a este produto.');
  const res = db
    .prepare(
      `INSERT INTO market_prices (product_id, variant_id, competitor, region, price, source, observed_at, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(m.productId, m.variantId, m.competitor, m.region, m.price, m.source, m.observedAt, m.notes);
  return mapMarket(db.prepare('SELECT * FROM market_prices WHERE id = ?').get(Number(res.lastInsertRowid)) as Row);
}

export function deleteMarket(db: DB, id: number) {
  const r = db.prepare('DELETE FROM market_prices WHERE id = ?').run(id);
  if (!r.changes) throw new NotFound('Preço de mercado');
}

// ───────── Transactions ─────────

const mapTx = (r: Row): Transaction => ({
  id: r.id,
  date: r.date,
  type: r.type,
  category: r.category,
  description: r.description,
  amount: r.amount,
  fee: r.fee,
  paymentMethod: r.payment_method,
  productId: r.product_id,
  variantId: r.variant_id,
  quantity: r.quantity,
  unitCost: r.unit_cost,
  ingredientId: r.ingredient_id,
  createdAt: r.created_at,
});

export type TxInput = Omit<Transaction, 'id' | 'createdAt'>;

export function listTransactions(db: DB, from?: string, to?: string): Transaction[] {
  return (
    db
      .prepare('SELECT * FROM transactions WHERE date >= ? AND date <= ? ORDER BY date DESC, id DESC')
      .all(from ?? '0000-01-01', to ?? '9999-12-31') as Row[]
  ).map(mapTx);
}

export function getTransaction(db: DB, id: number): Transaction {
  const r = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id) as Row | undefined;
  if (!r) throw new NotFound('Lançamento');
  return mapTx(r);
}

export function createTransaction(db: DB, t: TxInput): Transaction {
  const res = db
    .prepare(
      `INSERT INTO transactions (date, type, category, description, amount, fee, payment_method, product_id, variant_id,
       quantity, unit_cost, ingredient_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      t.date, t.type, t.category, t.description, t.amount, t.fee, t.paymentMethod,
      t.productId, t.variantId, t.quantity, t.unitCost, t.ingredientId,
    );
  return getTransaction(db, Number(res.lastInsertRowid));
}

export function updateTransaction(db: DB, id: number, t: TxInput): Transaction {
  getTransaction(db, id);
  db.prepare(
    `UPDATE transactions SET date=?, type=?, category=?, description=?, amount=?, fee=?, payment_method=?, product_id=?,
     variant_id=?, quantity=?, unit_cost=?, ingredient_id=? WHERE id=?`,
  ).run(
    t.date, t.type, t.category, t.description, t.amount, t.fee, t.paymentMethod,
    t.productId, t.variantId, t.quantity, t.unitCost, t.ingredientId, id,
  );
  return getTransaction(db, id);
}

export function deleteTransaction(db: DB, id: number) {
  const r = db.prepare('DELETE FROM transactions WHERE id = ?').run(id);
  if (!r.changes) throw new NotFound('Lançamento');
}
