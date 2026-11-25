import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Check, Clock, Plus, TrendingUp } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useStore } from '../lib/store.tsx';
import { date, money, moneyPrecise, number, pct, qtyBase } from '../lib/format.ts';
import { bucketLabel, PeriodPicker, usePeriod } from '../components/Period.tsx';
import { useFinance, TxForm } from './Finance.tsx';
import { usePricingRows } from './Pricing.tsx';
import { Button, Card, cx, Empty, Notice, PageHeader, Stat } from '../components/ui.tsx';

export default function Dashboard() {
  const { settings, ingredients, recipes, products, reload } = useStore();
  const [period, setPeriod] = usePeriod();
  const { data, error, load } = useFinance(period.from, period.to, period.gran);
  const [selling, setSelling] = useState(false);
  const rows = usePricingRows();

  const chart = useMemo(() => {
    let acc = 0;
    return (data?.series ?? []).map((s) => {
      acc += s.saldo;
      return { label: bucketLabel(s.bucket, period.gran), saldo: s.saldo, acumulado: acc };
    });
  }, [data, period.gran]);

  const losing = rows.filter((r) => r.pricing?.current?.belowMinimum);
  const lowMargin = rows.filter((r) => r.pricing?.current && !r.pricing.current.belowMinimum && r.pricing.current.marginPct + 0.05 < r.pricing.marginPct);
  const bestMargin = [...rows].filter((r) => r.pricing?.current).sort((a, b) => b.pricing!.current!.marginPct - a.pricing!.current!.marginPct).slice(0, 5);

  const setupSteps = [
    { done: ingredients.length > 0, label: 'Cadastrar ingredientes e preços', to: '/ingredientes' },
    { done: recipes.length > 0, label: 'Montar as receitas', to: '/receitas' },
    { done: products.length > 0, label: 'Cadastrar os produtos', to: '/produtos' },
    { done: settings.laborMonthly > 0 || settings.fixedCosts.length > 0, label: 'Informar mão de obra e despesas fixas', to: '/configuracoes' },
  ];
  const setupDone = setupSteps.every((s) => s.done);
  const t = data?.totals;

  return (
    <>
      <PageHeader
        title={settings.businessName ? `Olá, ${settings.businessName}` : 'Painel'}
        description="Resumo financeiro e alertas da confeitaria."
        actions={products.length > 0 && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setSelling(true)}>Registrar venda</Button>}
      />

      {!setupDone && (
        <Card className="mb-5" title="Primeiros passos" subtitle="Siga a ordem: o sistema usa cada etapa para calcular a próxima.">
          <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {setupSteps.map((s, i) => (
              <li key={s.to}>
                <Link to={s.to} className={cx('flex h-full items-center gap-3 rounded-lg border px-3 py-2.5 text-[13px] transition-colors', s.done ? 'border-line bg-subtle/50 text-muted' : 'border-line hover:border-line-strong hover:bg-subtle/50')}>
                  <span className={cx('flex size-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold', s.done ? 'bg-pos-soft text-pos' : 'bg-ink text-white')}>
                    {s.done ? <Check className="size-3.5" /> : i + 1}
                  </span>
                  <span className={cx('font-medium', s.done && 'line-through decoration-faint')}>{s.label}</span>
                </Link>
              </li>
            ))}
          </ol>
        </Card>
      )}

      <div className="mb-4"><PeriodPicker value={period} onChange={setPeriod} /></div>
      {error && <Notice tone="neg" className="mb-4">{error}</Notice>}

      {t && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Faturamento" value={money(t.revenue)} hint={`${t.salesCount} venda(s) · ${number(t.unitsSold)} un`} />
          <Stat label="Custos de produção" value={money(t.cogs)} hint={t.salesRevenue > 0 ? `${pct((t.cogs / t.salesRevenue) * 100)} do faturamento` : 'Custo dos produtos vendidos'} />
          <Stat label="Despesas" value={money(t.expenses + t.fees + t.taxes)} hint="Fixas, variáveis, taxas e impostos" />
          <Stat label={t.estimatedProfit >= 0 ? 'Lucro líquido estimado' : 'Prejuízo estimado'} value={money(t.estimatedProfit)} tone={t.estimatedProfit >= 0 ? 'pos' : 'neg'} hint={t.revenue > 0 ? `Margem ${pct((t.estimatedProfit / t.revenue) * 100)}` : undefined} />
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Evolução financeira" subtitle="Saldo de caixa acumulado no período" className="lg:col-span-2">
          {!data || chart.every((c) => c.saldo === 0) ? (
            <Empty title="Sem movimentação no período" description="Registre vendas e despesas no Financeiro." />
          ) : (
            <div className="h-64">
              <ResponsiveContainer>
                <AreaChart data={chart} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#b4385f" stopOpacity={0.18} />
                      <stop offset="100%" stopColor="#b4385f" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#e7e5e4" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#78716c' }} tickLine={false} axisLine={false} minTickGap={16} />
                  <YAxis tick={{ fontSize: 11, fill: '#78716c' }} tickLine={false} axisLine={false} width={76} tickFormatter={(v) => money(v)} />
                  <Tooltip formatter={(v, n) => [money(Number(v)), n === 'acumulado' ? 'Acumulado' : 'No período']} contentStyle={{ borderRadius: 8, border: '1px solid #e7e5e4', fontSize: 12 }} />
                  <Area type="linear" dataKey="acumulado" stroke="#b4385f" strokeWidth={2} fill="url(#g)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card title="Alertas" subtitle="Custos e preços que precisam de atenção">
          {(() => {
            const items = [
              ...(data?.alerts ?? []).map((a) => (
                <Link key={`a${a.ingredientId}`} to="/ingredientes" className="flex items-start gap-2.5 rounded-lg p-2 hover:bg-subtle">
                  <TrendingUp className="mt-0.5 size-4 shrink-0 text-neg" />
                  <div className="text-[12.5px]">
                    <div className="font-medium">{a.name} subiu {pct(a.changePct)}</div>
                    <div className="text-muted">{moneyPrecise(a.previous)} → {moneyPrecise(a.current)}/{a.baseUnit} em {date(a.date)}</div>
                  </div>
                </Link>
              )),
              ...losing.map((r) => (
                <Link key={`l${r.variant.id}`} to={`/precificacao?v=${r.variant.id}`} className="flex items-start gap-2.5 rounded-lg p-2 hover:bg-subtle">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-neg" />
                  <div className="text-[12.5px]">
                    <div className="font-medium">{r.product.name} · {r.variant.name} dá prejuízo</div>
                    <div className="text-muted">Preço {money(r.variant.salePrice)} · mínimo {money(r.pricing!.minimum)}</div>
                  </div>
                </Link>
              )),
              ...lowMargin.map((r) => (
                <Link key={`m${r.variant.id}`} to={`/precificacao?v=${r.variant.id}`} className="flex items-start gap-2.5 rounded-lg p-2 hover:bg-subtle">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />
                  <div className="text-[12.5px]">
                    <div className="font-medium">{r.product.name} · {r.variant.name}: margem {pct(r.pricing!.current!.marginPct)}</div>
                    <div className="text-muted">Meta {pct(r.pricing!.marginPct, 0)} · sugerido {money(r.pricing!.recommended)}</div>
                  </div>
                </Link>
              )),
              ...(data?.stale ?? []).slice(0, 4).map((s) => (
                <Link key={`s${s.id}`} to="/ingredientes" className="flex items-start gap-2.5 rounded-lg p-2 hover:bg-subtle">
                  <Clock className="mt-0.5 size-4 shrink-0 text-muted" />
                  <div className="text-[12.5px]">
                    <div className="font-medium">{s.name}: preço de {date(s.lastPurchaseDate)}</div>
                    <div className="text-muted">Mais de 90 dias. Confira se ainda vale.</div>
                  </div>
                </Link>
              )),
            ];
            return items.length ? <div className="-m-2 space-y-0.5">{items}</div> : <div className="flex items-center gap-2 text-[13px] text-muted"><Check className="size-4 text-pos" /> Nenhum alerta no momento.</div>;
          })()}
        </Card>
      </div>

      <div className="mt-4 grid items-start gap-4 lg:grid-cols-3">
        <Card title="Mais vendidos" subtitle="Quantidade no período" padded={false}>
          <RankList items={(data?.topSold ?? []).map((p) => ({ name: p.name, value: p.quantity, label: `${number(p.quantity)} un`, sub: money(p.revenue) }))} empty="Sem vendas no período." />
        </Card>
        <Card title="Mais lucrativos" subtitle="Lucro real das vendas no período" padded={false}>
          <RankList
            items={(data?.topProfitable ?? []).map((p) => ({ name: p.name, value: Math.max(p.profit, 0), label: money(p.profit), sub: p.revenue ? `margem ${pct((p.profit / p.revenue) * 100)}` : '', neg: p.profit < 0 }))}
            empty="Sem vendas no período."
          />
          {!data?.topProfitable.length && bestMargin.length > 0 && (
            <div className="border-t border-line px-4 py-3">
              <div className="mb-1.5 text-[11.5px] font-medium text-muted">Maior margem no preço atual</div>
              {bestMargin.map((r) => (
                <div key={r.variant.id} className="flex justify-between py-0.5 text-[12.5px]"><span className="truncate">{r.product.name} · {r.variant.name}</span><span className="num">{pct(r.pricing!.current!.marginPct)}</span></div>
              ))}
            </div>
          )}
        </Card>
        <Card title="Ingredientes mais usados" subtitle="Estimado pelas vendas e receitas atuais" padded={false}>
          <RankList items={(data?.ingredientsUsed ?? []).map((i) => ({ name: i.name, value: i.cost, label: money(i.cost), sub: qtyBase(i.baseQty, i.baseUnit) }))} empty="Sem vendas no período." />
        </Card>
      </div>

      {data && products.length > 0 && (
        <div className="mt-4 text-right">
          <Link to="/financeiro" className="inline-flex items-center gap-1 text-[12.5px] font-medium text-muted hover:text-ink">Ver todos os lançamentos <ArrowRight className="size-3.5" /></Link>
        </div>
      )}

      {selling && <TxForm kind="venda" onClose={() => setSelling(false)} onSaved={async () => { await load(); await reload('products'); }} />}
    </>
  );
}

function RankList({ items, empty }: { items: { name: string; value: number; label: string; sub?: string; neg?: boolean }[]; empty: string }) {
  if (!items.length) return <div className="px-4 py-8 text-center text-[13px] text-muted">{empty}</div>;
  const max = Math.max(...items.map((i) => i.value), 1e-9);
  return (
    <ul className="divide-y divide-line">
      {items.map((i, idx) => (
        <li key={idx} className="px-4 py-2.5">
          <div className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="truncate font-medium">{i.name}</span>
            <span className={cx('num shrink-0 font-semibold', i.neg && 'text-neg')}>{i.label}</span>
          </div>
          <div className="mt-1.5 flex items-center gap-3">
            <div className="h-1 flex-1 rounded-full bg-subtle"><div className="h-1 rounded-full bg-ink/70" style={{ width: `${(i.value / max) * 100}%` }} /></div>
            {i.sub && <span className="num shrink-0 text-[11.5px] text-muted">{i.sub}</span>}
          </div>
        </li>
      ))}
    </ul>
  );
}

