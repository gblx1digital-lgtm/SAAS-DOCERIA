// Banco de dados local: SQLite (WebAssembly) salvo no IndexedDB do navegador.
// Cada alteração é gravada antes de a tela confirmar o salvamento.
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url';
import { InvalidBackupError, openDatabase, type SqlJsDB } from '../../core/db.ts';
import { createApi, type ApiRequest, type ApiResponse } from '../../core/api.ts';
import { backupBytesFrom, makeBackupJson } from '../../core/backup.ts';

const IDB_NAME = 'doceria';
const IDB_STORE = 'kv';
const KEY_DB = 'database';
const KEY_META = 'meta';
const CHANNEL = 'doceria-sync';
/** Outra aba salvou: a tela deve recarregar os dados. */
export const EXTERNAL_CHANGE_EVENT = 'doceria:external-change';
/** Esta aba não pode mais gravar (dados substituídos/mais novos em outra aba): é preciso recarregar a página. */
export const BLOCKED_EVENT = 'doceria:blocked';

interface StoredDb {
  bytes: Uint8Array;
  version: number;
  /** Identidade do conjunto de dados; muda ao restaurar um backup ou apagar tudo. */
  generation?: string;
  savedAt: string;
}

export interface StorageMeta {
  lastBackupAt?: string;
  persisted?: boolean;
}

export type StorageMode = 'browser' | 'memory';

interface State {
  SQL: SqlJsStatic;
  db: SqlJsDB;
  handle: (r: ApiRequest) => ApiResponse;
  version: number;
  generation: string;
  /** Últimos bytes gravados (ou lidos) com sucesso: usados para desfazer se a gravação falhar. */
  lastSaved: Uint8Array | null;
  mode: StorageMode;
  /** Quando preenchido, esta aba não grava mais (mensagem para o usuário). */
  blocked: string | null;
}

let state: State | null = null;
let initPromise: Promise<State> | null = null;
let queue: Promise<unknown> = Promise.resolve();
let channel: BroadcastChannel | null = null;
/** Dados salvos que não puderam ser abertos (nunca são sobrescritos automaticamente). */
let unreadableBytes: Uint8Array | null = null;

export class StorageError extends Error {}

const MSG_RELOAD =
  'Os dados foram alterados em outra aba ou janela (por exemplo, um backup restaurado). Recarregue a página para continuar.';
const MSG_NEWER =
  'Os dados foram salvos por uma versão mais nova do sistema em outra aba. Recarregue a página para atualizar.';

const newGeneration = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

// ───────── IndexedDB ─────────

let idbPromise: Promise<IDBDatabase> | null = null;

function idb(): Promise<IDBDatabase> {
  if (!idbPromise) {
    const p = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB indisponível'));
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
      req.onsuccess = () => {
        const db = req.result;
        const forget = () => {
          if (idbPromise === p) idbPromise = null;
        };
        db.onversionchange = () => {
          db.close();
          forget();
        };
        // Conexão fechada pelo navegador (ex.: dados do site limpos): reabre na próxima operação.
        db.onclose = forget;
        resolve(db);
      };
      req.onerror = () => reject(req.error ?? new Error('Falha ao abrir o IndexedDB'));
      req.onblocked = () => reject(new Error('IndexedDB bloqueado por outra aba'));
    });
    idbPromise = p;
    p.catch(() => {
      if (idbPromise === p) idbPromise = null;
    });
  }
  return idbPromise;
}

/** Executa uma operação no IndexedDB; se a conexão tiver caído, reconecta e tenta mais uma vez. */
async function withIdb<T>(op: (db: IDBDatabase) => Promise<T>): Promise<T> {
  try {
    return await op(await idb());
  } catch (e) {
    const name = e instanceof DOMException ? e.name : '';
    if (name !== 'InvalidStateError' && name !== 'TransactionInactiveError' && name !== 'UnknownError') throw e;
    idbPromise = null;
    return op(await idb());
  }
}

function idbGet<T>(key: string): Promise<T | undefined> {
  return withIdb(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const req = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key);
        req.onsuccess = () => resolve(req.result as T | undefined);
        req.onerror = () => reject(req.error);
      }),
  );
}

function idbPut(key: string, value: unknown): Promise<void> {
  return withIdb(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const t = db.transaction(IDB_STORE, 'readwrite');
        t.objectStore(IDB_STORE).put(value, key);
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error ?? new Error('Falha ao gravar'));
        t.onabort = () => reject(t.error ?? new Error('Gravação cancelada (espaço insuficiente?)'));
      }),
  );
}

// ───────── Inicialização ─────────

function setState(
  SQL: SqlJsStatic,
  db: SqlJsDB,
  opts: { version: number; generation: string; lastSaved: Uint8Array | null; mode: StorageMode },
): State {
  const previous = state;
  state = { SQL, db, handle: createApi(db), blocked: null, ...opts };
  if (previous && previous.db !== db) previous.db.close();
  return state;
}

async function loadSql(): Promise<SqlJsStatic> {
  try {
    return await initSqlJs({ locateFile: () => wasmUrl });
  } catch {
    throw new StorageError(
      'Não foi possível carregar o banco de dados do sistema. Verifique a internet e toque em “Tentar novamente”.',
    );
  }
}

async function init(): Promise<State> {
  const SQL = await loadSql();
  let stored: StoredDb | undefined;
  let mode: StorageMode = 'browser';
  try {
    stored = await idbGet<StoredDb>(KEY_DB);
  } catch {
    mode = 'memory';
  }
  if (stored?.bytes) {
    try {
      return setState(SQL, openDatabase(SQL, stored.bytes), {
        version: stored.version ?? 0,
        generation: stored.generation ?? 'legacy',
        lastSaved: stored.bytes,
        mode,
      });
    } catch (e) {
      unreadableBytes = stored.bytes;
      throw new StorageError(
        `Não foi possível abrir os dados salvos neste navegador. ${e instanceof Error ? e.message : ''} ` +
          'Seus dados não foram apagados: baixe uma cópia em Custos e configurações ou restaure um backup.',
      );
    }
  }
  return setState(SQL, openDatabase(SQL, null), {
    version: stored?.version ?? 0,
    generation: newGeneration(),
    lastSaved: null,
    mode,
  });
}

function ensureReady(): Promise<State> {
  if (state) return Promise.resolve(state);
  if (!initPromise) {
    const p = init().then((s) => {
      setupSync();
      return s;
    });
    initPromise = p;
    // Falha passageira (internet, armazenamento): permite tentar de novo.
    // Dados ilegíveis: continua bloqueado até restaurar/apagar, para nunca sobrescrevê-los.
    p.catch(() => {
      if (!unreadableBytes && initPromise === p) initPromise = null;
    });
  }
  return initPromise;
}

export interface StorageInfo {
  mode: StorageMode;
  unreadable: boolean;
  blocked: string | null;
}

export async function getStorageInfo(): Promise<StorageInfo> {
  try {
    const s = await ensureReady();
    return { mode: s.mode, unreadable: false, blocked: s.blocked };
  } catch {
    return { mode: 'browser', unreadable: !!unreadableBytes, blocked: null };
  }
}

// ───────── Sincronização entre abas ─────────

let syncReady = false;

function setupSync() {
  if (syncReady || typeof window === 'undefined') return;
  syncReady = true;
  if ('BroadcastChannel' in window) {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (e) => {
      if (e.data?.type === 'saved') void refreshFromStorage();
    };
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refreshFromStorage();
  });
}

function block(s: State, message: string): never {
  s.blocked = message;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(BLOCKED_EVENT, { detail: message }));
  throw new StorageError(message);
}

/**
 * Compara com o que está salvo. Se outra aba salvou algo mais novo, carrega.
 * Se não for possível carregar (versão mais nova do sistema, dados substituídos), bloqueia a gravação.
 */
async function syncWithStorage(s: State): Promise<'same' | 'reloaded'> {
  if (s.mode !== 'browser') return 'same';
  if (s.blocked) throw new StorageError(s.blocked);
  let stored: StoredDb | undefined;
  try {
    stored = await idbGet<StoredDb>(KEY_DB);
  } catch {
    throw new StorageError('Não foi possível acessar o armazenamento do navegador. Recarregue a página e tente de novo.');
  }
  if (!stored?.bytes) return 'same';
  const storedGen = stored.generation ?? 'legacy';
  const hasOwnData = s.lastSaved !== null;
  if (storedGen !== s.generation && hasOwnData) block(s, MSG_RELOAD);
  if (storedGen === s.generation && (stored.version ?? 0) <= s.version) return 'same';
  let db: SqlJsDB;
  try {
    db = openDatabase(s.SQL, stored.bytes);
  } catch (e) {
    block(s, e instanceof InvalidBackupError && /mais nova/.test(e.message) ? MSG_NEWER : MSG_RELOAD);
  }
  setState(s.SQL, db, { version: stored.version ?? 0, generation: storedGen, lastSaved: stored.bytes, mode: s.mode });
  return 'reloaded';
}

const notifyExternalChange = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EXTERNAL_CHANGE_EVENT));
};

async function refreshFromStorage() {
  if (!state) return;
  await enqueue(async () => {
    try {
      if (state && (await syncWithStorage(state)) === 'reloaded') notifyExternalChange();
    } catch {
      /* bloqueio já avisado; demais erros: mantém os dados em memória */
    }
  });
}

/** Serializa alterações nesta aba e, quando possível, entre abas (Web Locks). */
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const locked = () =>
    typeof navigator !== 'undefined' && navigator.locks?.request
      ? (navigator.locks.request('doceria-db', fn) as Promise<T>)
      : fn();
  const run = queue.then(locked, locked);
  queue = run.catch(() => {});
  return run;
}

// ───────── Gravação ─────────

async function persist(s: State) {
  if (s.mode !== 'browser') return;
  const bytes = s.db.exportBytes();
  const version = s.version + 1;
  try {
    await idbPut(KEY_DB, { bytes, version, generation: s.generation, savedAt: new Date().toISOString() } satisfies StoredDb);
  } catch (e) {
    // Volta a tela para o que estava salvo, para não mostrar dados que não foram gravados.
    try {
      setState(s.SQL, openDatabase(s.SQL, s.lastSaved), { version: s.version, generation: s.generation, lastSaved: s.lastSaved, mode: s.mode });
    } catch {
      /* mantém em memória */
    }
    throw new StorageError(
      `A alteração NÃO foi salva neste navegador (${e instanceof Error ? e.message : e}). ` +
        'Verifique o espaço do aparelho, recarregue a página e faça um backup.',
    );
  }
  s.version = version;
  s.lastSaved = bytes;
  channel?.postMessage({ type: 'saved', version });
  void requestPersistence();
}

let persistenceAsked = false;

/** Pede ao navegador para não apagar os dados automaticamente. */
async function requestPersistence() {
  if (persistenceAsked || typeof navigator === 'undefined' || !navigator.storage?.persist) return;
  persistenceAsked = true;
  try {
    const already = await navigator.storage.persisted?.();
    const persisted = already || (await navigator.storage.persist());
    await setMeta({ persisted });
  } catch {
    /* opcional */
  }
}

// ───────── API local ─────────

export async function call(req: ApiRequest): Promise<ApiResponse> {
  await ensureReady();
  if (req.method === 'GET') return state!.handle(req);
  return enqueue(async () => {
    if ((await syncWithStorage(state!)) === 'reloaded') notifyExternalChange();
    const s = state!;
    const res = s.handle(req);
    if (res.status < 400) await persist(s);
    return res;
  });
}

// ───────── Backup, restauração e limpeza ─────────

export async function getMeta(): Promise<StorageMeta> {
  try {
    return (await idbGet<StorageMeta>(KEY_META)) ?? {};
  } catch {
    return {};
  }
}

async function setMeta(patch: Partial<StorageMeta>) {
  try {
    await idbPut(KEY_META, { ...(await getMeta()), ...patch });
  } catch {
    /* opcional */
  }
}

function localDate() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function makeBackupFile(bytes: Uint8Array, name: string): File {
  return new File([makeBackupJson(bytes, new Date().toISOString())], name, { type: 'application/json' });
}

function triggerDownload(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Entrega o arquivo ao usuário: no celular abre o menu de compartilhar
 * (Salvar em Arquivos, Drive, WhatsApp…); no computador faz o download.
 * Retorna false se o usuário cancelou.
 */
async function deliver(file: File): Promise<boolean> {
  const mobile = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  if (mobile && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name });
      return true;
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return false;
      // outros erros: tenta o download normal
    }
  }
  triggerDownload(file);
  return true;
}

export async function downloadBackup(): Promise<boolean> {
  await ensureReady();
  // Dentro da fila: usa o banco atual (já sincronizado com outras abas), nunca um fechado.
  const bytes = await enqueue(async () => {
    try {
      if ((await syncWithStorage(state!)) === 'reloaded') notifyExternalChange();
    } catch (e) {
      if (state!.blocked) throw e;
    }
    return state!.db.exportBytes();
  });
  const ok = await deliver(makeBackupFile(bytes, `doceria-backup-${localDate()}.json`));
  if (ok) await setMeta({ lastBackupAt: new Date().toISOString() });
  return ok;
}

/** Entrega os dados salvos que não puderam ser abertos (para não perdê-los). */
export async function downloadUnreadable() {
  if (unreadableBytes) await deliver(makeBackupFile(unreadableBytes, `doceria-dados-salvos-${localDate()}.json`));
}

/** Substitui todos os dados (restauração ou limpeza); outras abas são avisadas para recarregar. */
async function replaceAll(make: (SQL: SqlJsStatic) => SqlJsDB, SQL: SqlJsStatic) {
  await enqueue(async () => {
    const stored = await idbGet<StoredDb>(KEY_DB).catch(() => undefined);
    const prev = { bytes: stored?.bytes ?? null, version: stored?.version ?? 0, generation: stored?.generation ?? 'legacy' };
    const version = Math.max(state?.version ?? 0, prev.version);
    const mode = state?.mode ?? 'browser';
    const s = setState(SQL, make(SQL), { version, generation: newGeneration(), lastSaved: null, mode });
    try {
      await persist(s);
    } catch (e) {
      // Não gravou: volta a mostrar os dados que continuam salvos.
      try {
        setState(SQL, openDatabase(SQL, prev.bytes), { version: prev.version, generation: prev.generation, lastSaved: prev.bytes, mode });
      } catch {
        /* dados anteriores ilegíveis: permanecem intocados no armazenamento */
      }
      throw e;
    }
    unreadableBytes = null;
  });
  initPromise = Promise.resolve(state!);
  setupSync();
}

export async function restoreBackup(file: File) {
  if (file.size > 300 * 1024 * 1024) throw new InvalidBackupError('Arquivo grande demais para ser um backup deste sistema.');
  const bytes = backupBytesFrom(new Uint8Array(await file.arrayBuffer()));
  const SQL = state?.SQL ?? (await loadSql());
  const candidate = openDatabase(SQL, bytes, { strict: true });
  await replaceAll(() => candidate, SQL);
}

export async function resetAllData() {
  const SQL = state?.SQL ?? (await loadSql());
  await replaceAll((sql) => openDatabase(sql, null), SQL);
}
