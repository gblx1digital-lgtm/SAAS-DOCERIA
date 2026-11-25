// Banco de dados SQLite rodando no navegador (sql.js / WebAssembly).
// O mesmo código roda nos testes (Node) e no site publicado.
import type { Database as SqlJsDatabase, SqlJsStatic } from 'sql.js';

export type Param = number | string | null | Uint8Array;
export type Row = Record<string, any>;

export interface Statement {
  run(...params: Param[]): { changes: number; lastInsertRowid: number };
  get(...params: Param[]): Row | undefined;
  all(...params: Param[]): Row[];
}

export interface DB {
  exec(sql: string): void;
  prepare(sql: string): Statement;
}

/** Versão do esquema gravada em PRAGMA user_version. */
export const SCHEMA_VERSION = 1;

export const REQUIRED_TABLES = [
  'settings',
  'ingredients',
  'ingredient_price_history',
  'recipes',
  'recipe_items',
  'products',
  'product_variants',
  'variant_components',
  'variant_items',
  'market_prices',
  'transactions',
] as const;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ingredients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  supplier TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL CHECK (unit IN ('g','kg','ml','l','un')),
  package_size REAL NOT NULL CHECK (package_size > 0),
  packs REAL NOT NULL CHECK (packs > 0),
  total_price REAL NOT NULL CHECK (total_price >= 0),
  last_purchase_date TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ingredients_name ON ingredients (lower(name));

CREATE TABLE IF NOT EXISTS ingredient_price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  total_price REAL NOT NULL,
  package_size REAL NOT NULL,
  packs REAL NOT NULL,
  unit TEXT NOT NULL,
  cost_per_base REAL NOT NULL,
  purchase_date TEXT NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS history_ing ON ingredient_price_history (ingredient_id, id);

CREATE TABLE IF NOT EXISTS recipes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  yield_qty REAL NOT NULL CHECK (yield_qty > 0),
  yield_label TEXT NOT NULL DEFAULT 'unidades',
  portions REAL,
  total_weight_g REAL,
  prep_minutes REAL NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS recipe_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,
  quantity REAL NOT NULL CHECK (quantity > 0),
  unit TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS product_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sale_price REAL,
  target_margin REAL,
  extra_minutes REAL NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS variant_components (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  variant_id INTEGER NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE RESTRICT,
  mode TEXT NOT NULL CHECK (mode IN ('batch','unit','gram')),
  quantity REAL NOT NULL CHECK (quantity > 0),
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS variant_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  variant_id INTEGER NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,
  quantity REAL NOT NULL CHECK (quantity > 0),
  unit TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS market_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id INTEGER REFERENCES product_variants(id) ON DELETE CASCADE,
  competitor TEXT NOT NULL,
  region TEXT NOT NULL DEFAULT '',
  price REAL NOT NULL CHECK (price > 0),
  source TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('entrada','saida')),
  category TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  amount REAL NOT NULL CHECK (amount >= 0),
  fee REAL NOT NULL DEFAULT 0,
  payment_method TEXT,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  variant_id INTEGER REFERENCES product_variants(id) ON DELETE SET NULL,
  quantity REAL,
  unit_cost REAL,
  ingredient_id INTEGER REFERENCES ingredients(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS tx_date ON transactions (date);
`;

export class InvalidBackupError extends Error {}

const toParams = (params: Param[]) => params.map((p) => p ?? null);

/** Adaptador sql.js → interface síncrona usada pelos repositórios. */
export class SqlJsDB implements DB {
  private raw: SqlJsDatabase;

  constructor(raw: SqlJsDatabase) {
    this.raw = raw;
    this.raw.exec('PRAGMA foreign_keys = ON;');
  }

  exec(sql: string) {
    this.raw.exec(sql);
  }

  prepare(sql: string): Statement {
    const raw = this.raw;
    const each = (params: Param[], onRow: (r: Row) => boolean | void) => {
      const st = raw.prepare(sql);
      try {
        if (params.length) st.bind(toParams(params));
        while (st.step()) if (onRow(st.getAsObject() as Row) === false) break;
      } finally {
        st.free();
      }
    };
    return {
      run: (...params) => {
        raw.run(sql, params.length ? toParams(params) : undefined);
        const changes = raw.getRowsModified();
        const res = raw.exec('SELECT last_insert_rowid()');
        return { changes, lastInsertRowid: Number(res[0]?.values[0]?.[0] ?? 0) };
      },
      get: (...params) => {
        let row: Row | undefined;
        each(params, (r) => {
          row = r;
          return false;
        });
        return row;
      },
      all: (...params) => {
        const rows: Row[] = [];
        each(params, (r) => {
          rows.push(r);
        });
        return rows;
      },
    };
  }

  /** Serializa o banco inteiro (para salvar no navegador ou baixar como backup). */
  exportBytes(): Uint8Array {
    const bytes = this.raw.export();
    // sql.js fecha e reabre a conexão ao exportar: reativa as chaves estrangeiras.
    this.raw.exec('PRAGMA foreign_keys = ON;');
    return bytes;
  }

  close() {
    this.raw.close();
  }
}

let savepointDepth = 0;

/**
 * Executa `fn` numa transação; desfaz tudo em caso de erro.
 * Usa SAVEPOINTs, então pode ser aninhada (a requisição inteira e cada operação interna).
 */
export function tx<T>(db: DB, fn: () => T): T {
  const name = `sp_${savepointDepth++}`;
  db.exec(`SAVEPOINT ${name}`);
  try {
    const result = fn();
    db.exec(`RELEASE ${name}`);
    return result;
  } catch (e) {
    db.exec(`ROLLBACK TO ${name}`);
    db.exec(`RELEASE ${name}`);
    throw e;
  } finally {
    savepointDepth--;
  }
}

function migrate(db: SqlJsDB) {
  db.exec(SCHEMA);
  const current = Number(db.prepare('PRAGMA user_version').get()?.user_version ?? 0);
  if (current > SCHEMA_VERSION) {
    throw new InvalidBackupError(
      'Estes dados foram criados por uma versão mais nova do sistema. Atualize o site antes de abri-los.',
    );
  }
  // Migrações futuras: if (current < 2) { ... }
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
  db.exec("INSERT OR IGNORE INTO app_meta (key, value) VALUES ('app', 'doceria')");
}

const SQLITE_HEADER = 'SQLite format 3\u0000';

export function looksLikeSqlite(bytes: Uint8Array): boolean {
  if (bytes.length < 100) return false;
  for (let i = 0; i < SQLITE_HEADER.length; i++) if (bytes[i] !== SQLITE_HEADER.charCodeAt(i)) return false;
  return true;
}

/**
 * Abre o banco a partir dos bytes salvos (ou cria um vazio), aplicando o esquema.
 * Com `strict`, valida que o arquivo é um backup deste sistema (usado na restauração).
 */
export function openDatabase(SQL: SqlJsStatic, bytes?: Uint8Array | null, opts: { strict?: boolean } = {}): SqlJsDB {
  if (bytes && !looksLikeSqlite(bytes)) {
    throw new InvalidBackupError('O arquivo não é um backup válido deste sistema.');
  }
  let raw: SqlJsDatabase;
  try {
    raw = bytes ? new SQL.Database(bytes) : new SQL.Database();
  } catch {
    throw new InvalidBackupError('Não foi possível abrir o arquivo de dados (arquivo corrompido?).');
  }
  const db = new SqlJsDB(raw);
  try {
    if (bytes) {
      const check = db.prepare('PRAGMA quick_check').get();
      if (!check || Object.values(check)[0] !== 'ok') throw new InvalidBackupError('O arquivo de dados está corrompido.');
      if (opts.strict) {
        const tables = new Set(
          db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => String(r.name)),
        );
        const missing = REQUIRED_TABLES.filter((t) => !tables.has(t));
        if (missing.length) throw new InvalidBackupError('O arquivo não é um backup deste sistema.');
      }
    }
    if (opts.strict && db.prepare('PRAGMA foreign_key_check').all().length > 0) {
      throw new InvalidBackupError('O arquivo de backup tem registros inconsistentes.');
    }
    migrate(db);
    return db;
  } catch (e) {
    db.close();
    if (e instanceof InvalidBackupError) throw e;
    throw new InvalidBackupError(`Não foi possível abrir o arquivo de dados: ${e instanceof Error ? e.message : String(e)}`);
  }
}
