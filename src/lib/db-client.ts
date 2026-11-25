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
export const EXTERNAL_CHANGE_EVENT = 'doceria:external-change';

interface StoredDb {
  bytes: Uint8Array;
  version: number;
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
  mode: StorageMode;
}

let state: State | null = null;
let initPromise: Promise<State> | null = null;
let queue: Promise<unknown> = Promise.resolve();
let channel: BroadcastChannel | null = null;
/** Dados salvos que não puderam ser abertos (nunca são sobrescritos automaticamente). */
let unreadableBytes: Uint8Array | null = null;

export class StorageError extends Error {}

// ───────── IndexedDB ─────────

let idbPromise: Promise<IDBDatabase> | null = null;

function idb(): Promise<IDBDatabase> {
  if (!idbPromise) {
    idbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB indisponível'));
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      req.onerror = () => reject(req.error ?? new Error('Falha ao abrir o IndexedDB'));
      req.onblocked = () => reject(new Error('IndexedDB bloqueado por outra aba'));
    });
    idbPromise.catch(() => (idbPromise = null));
  }
  return idbPromise;
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await idb();
  return new Promise<T | undefined>((resolve, reject) => {
    const req = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(key: string, value: unknown): Promise<void> {
  const db = await idb();
  return new Promise<void>((resolve, reject) => {
    const t = db.transaction(IDB_STORE, 'readwrite');
    t.objectStore(IDB_STORE).put(value, key);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error ?? new Error('Falha ao gravar'));
    t.onabort = () => reject(t.error ?? new Error('Gravação cancelada (espaço insuficiente?)'));
  });
}

// ───────── Inicialização ─────────

function setState(SQL: SqlJsStatic, db: SqlJsDB, version: number, mode: StorageMode): State {
  state?.db.close();
  state = { SQL, db, handle: createApi(db), version, mode };
  return state;
}

async function init(): Promise<State> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  let stored: StoredDb | undefined;
  let mode: StorageMode = 'browser';
  try {
    stored = await idbGet<StoredDb>(KEY_DB);
  } catch {
    mode = 'memory';
  }
  if (stored?.bytes) {
    try {
      return setState(SQL, openDatabase(SQL, stored.bytes), stored.version ?? 0, mode);
    } catch (e) {
      unreadableBytes = stored.bytes;
      throw new StorageError(
        `Não foi possível abrir os dados salvos neste navegador. ${e instanceof Error ? e.message : ''} ` +
          'Seus dados não foram apagados: baixe uma cópia em Custos e configurações ou restaure um backup.',
      );
    }
  }
  return setState(SQL, openDatabase(SQL, null), stored?.version ?? 0, mode);
}

function ensureReady(): Promise<State> {
  if (state) return Promise.resolve(state);
  if (!initPromise) {
    initPromise = init().then((s) => {
      setupSync();
      return s;
    });
    initPromise.catch(() => {});
  }
  return initPromise;
}

export async function getStorageInfo(): Promise<{ mode: StorageMode; unreadable: boolean }> {
  try {
    const s = await ensureReady();
    return { mode: s.mode, unreadable: false };
  } catch {
    return { mode: 'browser', unreadable: !!unreadableBytes };
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

/** Recarrega do armazenamento se outra aba salvou uma versão mais nova. */
async function reloadIfStale(): Promise<boolean> {
  const s = state;
  if (!s || s.mode !== 'browser') return false;
  const stored = await idbGet<StoredDb>(KEY_DB);
  if (!stored?.bytes || (stored.version ?? 0) <= s.version) return false;
  setState(s.SQL, openDatabase(s.SQL, stored.bytes), stored.version, s.mode);
  return true;
}

async function refreshFromStorage() {
  await enqueue(async () => {
    try {
      if (await reloadIfStale()) window.dispatchEvent(new Event(EXTERNAL_CHANGE_EVENT));
    } catch {
      /* mantém os dados em memória */
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
    await idbPut(KEY_DB, { bytes, version, savedAt: new Date().toISOString() } satisfies StoredDb);
  } catch (e) {
    // Volta a tela para o que está realmente salvo, para não mostrar dados que não foram gravados.
    try {
      const stored = await idbGet<StoredDb>(KEY_DB);
      setState(s.SQL, openDatabase(s.SQL, stored?.bytes ?? null), stored?.version ?? s.version, s.mode);
    } catch {
      /* mantém em memória */
    }
    throw new StorageError(
      `A alteração não pôde ser salva neste navegador (${e instanceof Error ? e.message : e}). ` +
        'Verifique o espaço do aparelho e faça um backup.',
    );
  }
  s.version = version;
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
    await reloadIfStale().catch(() => false);
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
  const s = await ensureReady();
  const bytes = await enqueue(async () => s.db.exportBytes());
  const ok = await deliver(makeBackupFile(bytes, `doceria-backup-${localDate()}.json`));
  if (ok) await setMeta({ lastBackupAt: new Date().toISOString() });
  return ok;
}

/** Entrega os dados salvos que não puderam ser abertos (para não perdê-los). */
export async function downloadUnreadable() {
  if (unreadableBytes) await deliver(makeBackupFile(unreadableBytes, `doceria-dados-salvos-${localDate()}.json`));
}

export async function restoreBackup(file: File) {
  if (file.size > 300 * 1024 * 1024) throw new InvalidBackupError('Arquivo grande demais para ser um backup deste sistema.');
  const bytes = backupBytesFrom(new Uint8Array(await file.arrayBuffer()));
  const SQL = state?.SQL ?? (await initSqlJs({ locateFile: () => wasmUrl }));
  const candidate = openDatabase(SQL, bytes, { strict: true });
  await enqueue(async () => {
    const stored = await idbGet<StoredDb>(KEY_DB).catch(() => undefined);
    const version = Math.max(state?.version ?? 0, stored?.version ?? 0);
    const s = setState(SQL, candidate, version, state?.mode ?? 'browser');
    unreadableBytes = null;
    await persist(s);
  });
  initPromise = Promise.resolve(state!);
}

export async function resetAllData() {
  const SQL = state?.SQL ?? (await initSqlJs({ locateFile: () => wasmUrl }));
  await enqueue(async () => {
    const stored = await idbGet<StoredDb>(KEY_DB).catch(() => undefined);
    const version = Math.max(state?.version ?? 0, stored?.version ?? 0);
    const s = setState(SQL, openDatabase(SQL, null), version, state?.mode ?? 'browser');
    unreadableBytes = null;
    await persist(s);
  });
  initPromise = Promise.resolve(state!);
}
