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

  const range =
    saved.preset === 'custom' && saved.from && saved.to ? { from: saved.from, to: saved.to } : presetRange(saved.preset, today);
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
          <div className="w-[150px]">
            <Input
              type="date"
              value={value.from}
              min="2000-01-01"
              max={value.to}
              aria-label="De"
              onChange={(e) => {
                const from = e.target.value;
                if (!from) return;
                // Nunca deixa o início depois do fim.
                onChange({ ...value, from, to: from > value.to ? from : value.to });
              }}
            />
          </div>
          <div className="w-[150px]">
            <Input
              type="date"
              value={value.to}
              min={value.from}
              aria-label="Até"
              onChange={(e) => {
                const to = e.target.value;
                if (!to) return;
                onChange({ ...value, to, from: to < value.from ? to : value.from });
              }}
            />
          </div>
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

export function bucketLabel(b: string, g: Gran) {
  if (g === 'month') {
    const [y, m] = b.split('-');
    return `${['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][Number(m) - 1]}/${y.slice(2)}`;
  }
  const [, m, d] = b.split('-');
  return `${d}/${m}`;
}
