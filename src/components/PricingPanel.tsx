import type { CostBreakdown, Pricing } from '../../shared/calc.ts';
import { minutes, money, pct } from '../lib/format.ts';
import { Badge, cx } from './ui.tsx';

const PARTS: { key: keyof CostBreakdown; label: string; color: string }[] = [
  { key: 'ingredients', label: 'Ingredientes', color: '#b4385f' },
  { key: 'packaging', label: 'Embalagens', color: '#d97b9a' },
  { key: 'waste', label: 'Desperdício', color: '#efb8ca' },
  { key: 'labor', label: 'Mão de obra', color: '#44403c' },
  { key: 'utilities', label: 'Energia, gás e água', color: '#a8a29e' },
  { key: 'fixed', label: 'Despesas fixas', color: '#d6d3d1' },
];

export function CostBars({ b }: { b: CostBreakdown }) {
  const total = b.total || 1;
  return (
    <div>
      <div className="flex h-2 overflow-hidden rounded-full bg-line">
        {PARTS.map((p) => (b[p.key] as number) > 0 && (
          <div key={p.key} style={{ width: `${((b[p.key] as number) / total) * 100}%`, background: p.color }} title={p.label} />
        ))}
      </div>
      <dl className="mt-3 space-y-1.5 text-[12.5px]">
        {PARTS.map((p) => (
          <div key={p.key} className="flex items-center justify-between gap-3">
            <dt className="flex items-center gap-2 text-ink-2">
              <span className="size-2 rounded-sm" style={{ background: p.color }} />
              {p.label}
            </dt>
            <dd className="num text-ink">{money(b[p.key] as number)}</dd>
          </div>
        ))}
        <div className="flex items-center justify-between gap-3 border-t border-line pt-1.5 text-[12px] text-muted">
          <dt>Tempo de trabalho por unidade</dt>
          <dd className="num">{minutes(b.minutes)}</dd>
        </div>
      </dl>
    </div>
  );
}

export function PriceTiers({ p, compact }: { p: Pricing; compact?: boolean }) {
  if (p.error) return <div className="rounded-lg border border-neg/20 bg-neg-soft p-3 text-[12.5px] text-neg">{p.error}</div>;
  const tiers = [
    { label: 'Preço mínimo', hint: 'Cobre custos, taxas e impostos. Lucro zero.', value: p.minimum, margin: 0 },
    { label: 'Recomendado', hint: `Margem de ${pct(p.marginPct, 0)}`, value: p.recommended, margin: p.marginPct, main: true },
    { label: 'Margem maior', hint: `Margem de ${pct(p.premiumMarginPct, 0)}`, value: p.premium, margin: p.premiumMarginPct },
  ];
  return (
    <div className={cx('grid gap-2', compact ? 'grid-cols-3' : 'grid-cols-1 sm:grid-cols-3')}>
      {tiers.map((t) => (
        <div key={t.label} className={cx('rounded-lg border px-3 py-2.5', t.main ? 'border-ink bg-ink text-white' : 'border-line bg-surface')}>
          <div className={cx('text-[11.5px] font-medium', t.main ? 'text-white/70' : 'text-muted')}>{t.label}</div>
          <div className="num mt-0.5 text-[18px] font-semibold tracking-[-0.01em]">{money(t.value)}</div>
          {!compact && <div className={cx('mt-0.5 text-[11.5px]', t.main ? 'text-white/60' : 'text-muted')}>{t.hint}</div>}
        </div>
      ))}
    </div>
  );
}

export function CurrentPriceBadge({ p }: { p: Pricing }) {
  if (!p.current) return <Badge>Sem preço definido</Badge>;
  if (p.current.belowMinimum) return <Badge tone="neg">Prejuízo de {money(-p.current.profit)}/un</Badge>;
  if (p.current.marginPct + 0.05 < p.marginPct) return <Badge tone="warn">Margem {pct(p.current.marginPct)}</Badge>;
  return <Badge tone="pos">Margem {pct(p.current.marginPct)}</Badge>;
}
