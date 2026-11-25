import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './api.ts';
import { BLOCKED_EVENT, EXTERNAL_CHANGE_EVENT, getMeta, getStorageInfo, type StorageMode } from './db-client.ts';
import { indexById, type CalcContext } from '../../shared/calc.ts';
import {
  DEFAULT_SETTINGS,
  type Ingredient,
  type MarketPrice,
  type PriceHistoryEntry,
  type Product,
  type Recipe,
  type Settings,
} from '../../shared/types.ts';

interface Data {
  ingredients: Ingredient[];
  recipes: Recipe[];
  products: Product[];
  settings: Settings;
  market: MarketPrice[];
  history: PriceHistoryEntry[];
}

export interface StorageStatus {
  mode: StorageMode;
  /** Dados salvos existem mas não puderam ser abertos. */
  unreadable: boolean;
  lastBackupAt: string | null;
  persisted: boolean | null;
  /** Esta aba precisa ser recarregada (dados alterados/substituídos em outra aba). */
  blocked: string | null;
}

interface Store extends Data {
  loading: boolean;
  error: string | null;
  ctx: CalcContext;
  storage: StorageStatus;
  reload: (...keys: (keyof Data)[]) => Promise<void>;
  refreshStorage: () => Promise<void>;
}

const StoreCtx = createContext<Store | null>(null);

const endpoints: Record<keyof Data, string> = {
  ingredients: '/ingredients',
  recipes: '/recipes',
  products: '/products',
  settings: '/settings',
  market: '/market',
  history: '/ingredients/history',
};

export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Data>({
    ingredients: [],
    recipes: [],
    products: [],
    settings: DEFAULT_SETTINGS,
    market: [],
    history: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [storage, setStorage] = useState<StorageStatus>({ mode: 'browser', unreadable: false, lastBackupAt: null, persisted: null, blocked: null });

  const refreshStorage = useCallback(async () => {
    const [info, meta] = await Promise.all([getStorageInfo(), getMeta()]);
    setStorage({ mode: info.mode, unreadable: info.unreadable, lastBackupAt: meta.lastBackupAt ?? null, persisted: meta.persisted ?? null, blocked: info.blocked });
  }, []);

  const reload = useCallback(async (...keys: (keyof Data)[]) => {
    const list = keys.length ? keys : (Object.keys(endpoints) as (keyof Data)[]);
    try {
      const results = await Promise.all(list.map((k) => api.get<any>(endpoints[k])));
      setData((d) => {
        const next = { ...d };
        list.forEach((k, i) => ((next as any)[k] = results[i]));
        return next;
      });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    reload()
      .then(refreshStorage)
      .finally(() => setLoading(false));
  }, [reload, refreshStorage]);

  // Outra aba (ou janela) salvou alterações: recarrega tudo.
  useEffect(() => {
    const onChange = () => void reload();
    const onBlocked = (e: Event) => {
      const message = (e as CustomEvent<string>).detail;
      setStorage((s) => ({ ...s, blocked: message }));
    };
    window.addEventListener(EXTERNAL_CHANGE_EVENT, onChange);
    window.addEventListener(BLOCKED_EVENT, onBlocked);
    return () => {
      window.removeEventListener(EXTERNAL_CHANGE_EVENT, onChange);
      window.removeEventListener(BLOCKED_EVENT, onBlocked);
    };
  }, [reload]);

  const ctx = useMemo<CalcContext>(
    () => ({ ingredients: indexById(data.ingredients), recipes: indexById(data.recipes), settings: data.settings }),
    [data.ingredients, data.recipes, data.settings],
  );

  return <StoreCtx.Provider value={{ ...data, loading, error, ctx, storage, reload, refreshStorage }}>{children}</StoreCtx.Provider>;
}

export function useStore() {
  const s = useContext(StoreCtx);
  if (!s) throw new Error('StoreProvider ausente');
  return s;
}
