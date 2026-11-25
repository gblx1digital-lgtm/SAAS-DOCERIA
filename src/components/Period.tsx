import { useEffect, useState } from 'react';
import { addDays, todayISO } from '../lib/format.ts';
import { Input, Segmented, Select } from './ui.tsx';

export type Gran = 'day' | 'week' | 'month';
export interface Period { from: string; to: string; gran: Gran; preset: string }

const PRESETS = {
  today: 'Hoje',
  '7d': 'Últimos 7 dias',
  month: 'Este mês',
  lastMonth: 'Mês passado',
  '90d': 'Últimos 90 dias',
  year: 'Este ano',
  custom: 'Personalizado',
} as const;

function presetRange(p: string, t = todayISO()): { from: string; to: string; gran: Gran } {
  const [y, m] = t.split('-').map(Number);
  switch (p) {
    case 'today': return { from: t, to: t, gran: 'day' };
    case '7d': return { from: addDays(t, -6), to: t, gran: 'day' };
    case 'lastMonth': {
      const first = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
      const last = new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10);
      return { from: first, to: last, gran: 'day' };
    }
    case '90d': return { from: addDays(t, -89), to: t, gran: 'week' };
    case 'year': return { from: `${y}-01-01`, to: t, gran: 'month' };
    default: return { from: `${t.slice(0, 7)}-01`, to: t, gran: 'day' };
  }
}

const KEY = 'doceria.period';

/** Data inteira e plausível (o ano já foi digitado por completo). */
const isComplete = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= '2000-01-01' && d <= '2099-12-31';

interface Saved { preset: string; gran: Gran; from?: string; to?: string }

/**
 * Período escolhido. As datas dos atalhos ("Hoje", "Este mês"…) são recalculadas a cada
 * uso, então o sistema aberto de um dia para o outro continua mostrando o dia certo.
 */
export function usePeriod(): [Period, (p: Period) => void] {
  const [saved, setSaved] = useState<Saved>(() => {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) ?? 'null');
      if (s?.preset && s.preset in PRESETS) return { preset: s.preset, gran: s.gran ?? presetRange(s.preset).gran, from: s.from, to: s.to };
    } catch { /* ignorado */ }
    return { preset: 'month', gran: 'day' };
  });
  const [today, setToday] = useState(todayISO());

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* ignorado */ }
  }, [saved]);

  // Virou o dia com a página aberta: atualiza os atalhos.
  useEffect(() => {
    const check = () => setToday((t) => (t === todayISO() ? t : todayISO()));
    const id = window.setInterval(check, 60_000);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
    };
  }, []);

  let range =
    saved.preset === 'custom' && saved.from && saved.to ? { from: saved.from, to: saved.to } : presetRange(saved.preset, today);
  // Período personalizado com as datas invertidas: usa na ordem certa.
  if (range.from > range.to) range = { from: range.to, to: range.from };
  const period: Period = { preset: saved.preset, gran: saved.gran, from: range.from, to: range.to };
  const setPeriod = (p: Period) => setSaved({ preset: p.preset, gran: p.gran, ...(p.preset === 'custom' ? { from: p.from, to: p.to } : {}) });
  return [period, setPeriod];
}

export function PeriodPicker({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="w-44"><Select
        value={value.preset}
        onChange={(e) => {
          const preset = e.target.value;
          onChange(preset === 'custom' ? { ...value, preset } : { ...presetRange(preset), preset });
        }}
        aria-label="Período"
      >
        {Object.entries(PRESETS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </Select></div>
      {value.preset === 'custom' && (
        <>
          <DateField label="De" value={value.from} onCommit={(from) => onChange({ ...value, from })} />
          <DateField label="Até" value={value.to} onCommit={(to) => onChange({ ...value, to })} />
        </>
      )}
      <Segmented
        value={value.gran}
        onChange={(gran) => onChange({ ...value, gran })}
        options={[{ value: 'day', label: 'Dia' }, { value: 'week', label: 'Semana' }, { value: 'month', label: 'Mês' }]}
      />
    </div>
  );
}

/**
 * Campo de data que só aplica a data quando ela está completa. Enquanto o ano é digitado,
 * o navegador manda datas parciais (0002, 0020…), que ficam só no campo.
 */
function DateField({ label, value, onCommit }: { label: string; value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <div className="w-[150px]">
      <Input
        type="date"
        value={draft}
        min="2000-01-01"
        max="2099-12-31"
        aria-label={label}
        onChange={(e) => {
          setDraft(e.target.value);
          if (isComplete(e.target.value)) onCommit(e.target.value);
        }}
      />
    </div>
  );
}

export function bucketLabel(b: string, g: Gran) {
  if (g === 'month') {
    const [y, m] = b.split('-');
    return `${['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][Number(m) - 1]}/${y.slice(2)}`;
  }
  const [, m, d] = b.split('-');
  return `${d}/${m}`;
}
