// Formato do arquivo de backup: JSON com o banco SQLite em base64.
// JSON passa pelo menu de compartilhar de qualquer celular (Drive, Arquivos, WhatsApp, e-mail).
import { InvalidBackupError, looksLikeSqlite } from './db.ts';

export const BACKUP_FORMAT = 1;

export interface BackupEnvelope {
  app: 'doceria';
  format: number;
  createdAt: string;
  sqliteBase64: string;
}

export function toBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

export function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function makeBackupJson(bytes: Uint8Array, createdAt: string): string {
  const env: BackupEnvelope = { app: 'doceria', format: BACKUP_FORMAT, createdAt, sqliteBase64: toBase64(bytes) };
  return JSON.stringify(env);
}

/** Extrai o banco de um arquivo de backup (JSON deste sistema ou SQLite puro). */
export function backupBytesFrom(raw: Uint8Array): Uint8Array {
  if (looksLikeSqlite(raw)) return raw;
  let env: Partial<BackupEnvelope> | null = null;
  try {
    env = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    throw new InvalidBackupError('O arquivo não é um backup deste sistema.');
  }
  if (!env || env.app !== 'doceria' || typeof env.sqliteBase64 !== 'string')
    throw new InvalidBackupError('O arquivo não é um backup deste sistema.');
  if ((env.format ?? 0) > BACKUP_FORMAT) throw new InvalidBackupError('Este backup foi criado por uma versão mais nova do sistema.');
  let bytes: Uint8Array;
  try {
    bytes = fromBase64(env.sqliteBase64);
  } catch {
    throw new InvalidBackupError('O arquivo de backup está corrompido.');
  }
  if (!looksLikeSqlite(bytes)) throw new InvalidBackupError('O arquivo de backup está corrompido.');
  return bytes;
}
