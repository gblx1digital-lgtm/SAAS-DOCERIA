import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ExternalLink, Plus, Store, Trash2 } from 'lucide-react';
import { useStore } from '../lib/store.tsx';
import { api } from '../lib/api.ts';
import { competitivePrice, MARKET_MIN_SAMPLES, marketStats } from '../../shared/calc.ts';
import { date, money, parseNum, pct, todayISO } from '../lib/format.ts';
import { usePricingRows } from './Pricing.tsx';
import { MARKET_MAX_AGE_DAYS, marketCutoff, marketEntriesFor } from '../lib/market.ts';
import {
  Badge, Button, Card, cx, Empty, Field, IconButton, Input, Modal, Notice, NumInput, PageHeader, Select, TableWrap, Td, Textarea, Th, useDirty, useFeedback,
} from '../components/ui.tsx';

export default function Market() {
  const { products, market, settings, reload } = useStore();
  const rows = usePricingRows();
  const [params, setParams] = useSearchParams();
  const requested = Number(params.get('p'));
  // Produto pedido no endereço pode ter sido excluído: usa o primeiro.
  const product = products.find((p) => p.id === requested) ?? products[0] ?? null;
  const productId = product?.id ?? null;
  const [variantId, setVariantId] = useState<number | 'all'>('all');
  const [adding, setAdding] = useState(false);
  const [onlyRecent, setOnlyRecent] = useState(true);
  const { toast, confirm } = useFeedback();

  const cutoff = marketCutoff();
  // Lista à direita: todos os preços do filtro (incluindo os sem tamanho).
  const entries = useMemo(
    () =>
      market.filter(
        (m) =>
          m.productId === productId &&
          (variantId === 'all' || m.variantId === null || m.variantId === variantId) &&
          (!onlyRecent || m.observedAt >= cutoff),
      ),
    [market, productId, variantId, onlyRecent, cutoff],
  );
  const variantRows = rows.filter((r) => r.product.id === productId && (variantId === 'all' || r.variant.id === variantId));
  const multiSize = (product?.variants.length ?? 0) > 1;

  const remove = async (id: number) => {
    if (!(await confirm({ title: 'Remover preço', message: 'Remover este preço de concorrente?', confirmLabel: 'Remover', danger: true }))) return;
    try {
      await api.del(`/market/${id}`);
      await reload('market');
      toast('Preço removido.');
    } catch (e) {
      toast((e as Error).message, 'neg');
    }
  };

  return (
    <>
      <PageHeader
        title="Análise de mercado"
        description="Registre preços reais de concorrentes (cardápios, Instagram, iFood, visitas) com a fonte. A comparação só aparece com dados suficientes — nada é estimado ou inventado."
        actions={product && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>Registrar preço</Button>}
      />

      {products.length === 0 ? (
        <Card><Empty icon={<Store className="size-5" />} title="Cadastre produtos primeiro" description="A comparação de mercado é feita por produto." action={<Link to="/produtos"><Button variant="primary">Ir para produtos</Button></Link>} /></Card>
      ) : (
        <>
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            <Select value={productId ?? ''} onChange={(e) => { setParams({ p: e.target.value }); setVariantId('all'); }} className="sm:w-64">
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
            {product && product.variants.length > 1 && (
              <Select value={variantId} onChange={(e) => setVariantId(e.target.value === 'all' ? 'all' : Number(e.target.value))} className="sm:w-52">
                <option value="all">Todos os tamanhos</option>
                {product.variants.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </Select>
            )}
            <label className="flex items-center gap-2 text-[13px] text-ink-2 sm:ml-2">
              <input type="checkbox" checked={onlyRecent} onChange={(e) => setOnlyRecent(e.target.checked)} className="accent-[#1c1917]" />
              Só últimos {MARKET_MAX_AGE_DAYS} dias
            </label>
          </div>

          {multiSize && (
            <Notice className="mb-4">Cada tamanho é comparado só com preços registrados para o mesmo tamanho.</Notice>
          )}

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="space-y-4">
              {variantRows.map((r) => {
                const own = marketEntriesFor(market, r.product, r.variant.id, onlyRecent);
                const stats = marketStats(own.map((e) => e.price));
                const adv = stats && r.pricing ? competitivePrice(r.pricing, stats, settings.roundTo) : null;
                return (
                  <Card key={r.variant.id} title={`${r.product.name} · ${r.variant.name}`}>
                    {!r.pricing ? (
                      <Notice tone="neg">{r.error}</Notice>
                    ) : (
                      <>
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                          <Kpi label="Meu custo" value={money(r.pricing.cost)} />
                          <Kpi label="Meu preço" value={r.variant.salePrice ? money(r.variant.salePrice) : '—'} sub={r.pricing.current ? `margem ${pct(r.pricing.current.marginPct)}` : 'não definido'} />
                          <Kpi label="Mercado" value={stats ? `${money(stats.min)} – ${money(stats.max)}` : 'Indisponível'} sub={stats ? `mediana ${money(stats.median)}` : undefined} />
                          <Kpi label="Recomendado (custos)" value={money(r.pricing.recommended)} sub={`margem ${pct(r.pricing.marginPct, 0)}`} />
                        </div>
                        {stats ? (
                          <>
                            <RangeBar min={stats.min} max={stats.max} p25={stats.p25} p75={stats.p75} markers={[
                              { label: 'Mínimo', value: r.pricing.minimum!, color: '#c2410c' },
                              ...(r.variant.salePrice ? [{ label: 'Meu preço', value: r.variant.salePrice, color: '#1c1917' }] : []),
                              ...(adv ? [{ label: 'Sugerido', value: adv.price, color: '#b4385f' }] : []),
                            ]} />
                            {adv && (
                              <div className={cx('mt-4 rounded-lg border p-3.5', adv.status === 'saudavel' ? 'border-pos/20 bg-pos-soft' : adv.status === 'margem_apertada' ? 'border-warn/20 bg-warn-soft' : 'border-neg/20 bg-neg-soft')}>
                                <div className="flex flex-wrap items-baseline justify-between gap-2">
                                  <div className="text-[12.5px] font-medium text-ink-2">Preço competitivo sugerido</div>
                                  <div className="num text-[20px] font-semibold text-ink">{money(adv.price)}</div>
                                </div>
                                <div className="mt-1 text-[12.5px] text-ink-2">Lucro {money(adv.profit)}/un · margem {pct(adv.marginPct)}</div>
                                <p className="mt-2 text-[12.5px] text-ink-2">{adv.message}</p>
                                {adv.myPricePosition && (
                                  <p className="mt-1 text-[12.5px] text-ink-2">
                                    Seu preço atual está <b>{adv.myPricePosition === 'abaixo' ? 'abaixo da' : adv.myPricePosition === 'acima' ? 'acima da' : 'dentro da'}</b> faixa central do mercado ({money(stats.p25)} – {money(stats.p75)}).
                                  </p>
                                )}
                              </div>
                            )}
                          </>
                        ) : (
                          <Notice className="mt-4">
                            Comparação indisponível: {own.length === 0 ? 'nenhum preço de concorrente registrado para este tamanho' : `há ${own.length} preço(s) para este tamanho; são necessários pelo menos ${MARKET_MIN_SAMPLES}`}.
                            Pesquise cardápios de confeitarias da sua região{settings.city ? ` (${settings.city})` : ''} e registre com a fonte.
                          </Notice>
                        )}
                      </>
                    )}
                  </Card>
                );
              })}
            </div>

            <Card title="Preços registrados" subtitle={`${entries.length} no filtro atual`} padded={false}>
              {entries.length === 0 ? (
                <Empty title="Nenhum preço registrado" description="Adicione preços com a fonte para comparar." action={<Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setAdding(true)}>Registrar preço</Button>} />
              ) : (
                <TableWrap>
                  <thead><tr><Th>Concorrente</Th><Th align="right">Preço</Th><Th /></tr></thead>
                  <tbody>
                    {entries.map((e) => {
                      const v = product?.variants.find((x) => x.id === e.variantId);
                      const isUrl = /^https?:\/\//i.test(e.source);
                      return (
                        <tr key={e.id}>
                          <Td>
                            <div className="font-medium">{e.competitor}</div>
                            <div className="text-[11.5px] text-muted">
                              {[v?.name, e.region, date(e.observedAt)].filter(Boolean).join(' · ')}
                            </div>
                            {multiSize && e.variantId === null && (
                              <Badge tone="warn" className="mt-1">Sem tamanho: não entra na comparação</Badge>
                            )}
                            <div className="mt-0.5 max-w-[220px] truncate text-[11.5px] text-muted">
                              {isUrl ? <a href={e.source} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-accent hover:underline">Fonte <ExternalLink className="size-3" /></a> : `Fonte: ${e.source}`}
                            </div>
                          </Td>
                          <Td align="right" className="font-semibold">{money(e.price)}</Td>
                          <Td className="w-px"><IconButton label="Remover" className="hover:text-neg" onClick={() => remove(e.id)}><Trash2 className="size-4" /></IconButton></Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </TableWrap>
              )}
            </Card>
          </div>
        </>
      )}
      {adding && product && <MarketForm productId={product.id} defaultVariant={variantId === 'all' ? null : variantId} onClose={() => setAdding(false)} />}
    </>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-[11.5px] text-muted">{label}</div>
      <div className="num text-[15px] font-semibold">{value}</div>
      {sub && <div className="text-[11.5px] text-muted">{sub}</div>}
    </div>
  );
}

function RangeBar({ min, max, p25, p75, markers }: { min: number; max: number; p25: number; p75: number; markers: { label: string; value: number; color: string }[] }) {
  const lo = Math.min(min, ...markers.map((m) => m.value));
  const hi = Math.max(max, ...markers.map((m) => m.value));
  const span = hi - lo || 1;
  const x = (v: number) => `${((v - lo) / span) * 100}%`;
  return (
    <div className="mt-6 px-1">
      <div className="relative h-2 rounded-full bg-subtle">
        <div className="absolute h-2 rounded-full bg-line-strong" style={{ left: x(min), width: `calc(${x(max)} - ${x(min)})` }} />
        <div className="absolute h-2 rounded-full bg-ink-2/40" style={{ left: x(p25), width: `calc(${x(p75)} - ${x(p25)})` }} />
        {markers.map((m) => (
          <div key={m.label} className="absolute -top-1 h-4 w-0.5 rounded" style={{ left: x(m.value), background: m.color }} title={`${m.label}: ${money(m.value)}`} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-muted">
        <span className="flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm bg-line-strong" />Faixa do mercado</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm bg-ink-2/40" />Faixa central</span>
        {markers.map((m) => (
          <span key={m.label} className="flex items-center gap-1.5"><span className="h-3 w-0.5 rounded" style={{ background: m.color }} />{m.label} {money(m.value)}</span>
        ))}
      </div>
    </div>
  );
}

function MarketForm({ productId, defaultVariant, onClose }: { productId: number; defaultVariant: number | null; onClose: () => void }) {
  const { products, settings, reload } = useStore();
  const { toast } = useFeedback();
  const product = products.find((p) => p.id === productId)!;
  const [f, setF] = useState({
    variantId: (defaultVariant ?? product.variants[0]?.id ?? '') as number | '',
    competitor: '',
    region: settings.city,
    price: '',
    source: '',
    observedAt: todayISO(),
    notes: '',
  });
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = useDirty(f);
  const price = parseNum(f.price);
  const errs = {
    competitor: !f.competitor.trim() ? 'Informe o concorrente.' : null,
    price: !(price > 0) ? 'Informe o preço.' : null,
    source: !f.source.trim() ? 'Informe onde viu o preço (link, cardápio, visita…).' : null,
    variant: f.variantId === '' ? 'Escolha o tamanho equivalente.' : null,
    observedAt: !f.observedAt ? 'Informe a data.' : null,
  };
  const valid = Object.values(errs).every((e) => !e);

  const submit = async () => {
    if (saving) return;
    setTouched(true);
    if (!valid) return;
    setSaving(true);
    setError(null);
    try {
      await api.post('/market', { ...f, productId, variantId: f.variantId === '' ? null : f.variantId, price });
      await reload('market');
      toast('Preço registrado.');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      footerNote={error ?? (touched && !valid ? 'Confira os campos destacados em vermelho.' : null)}
      dirty={dirty}
      title={`Registrar preço · ${product.name}`}
      description="Use apenas preços que você viu de fato. Informe a fonte para poder conferir depois."
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={saving} onClick={submit}>Registrar</Button></>}
    >
      <form className="grid grid-cols-1 gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <button type="submit" hidden />
        {error && <Notice tone="neg" className="sm:col-span-2">{error}</Notice>}
        <Field label="Concorrente" error={touched ? errs.competitor : null}>
          <Input value={f.competitor} onChange={(e) => setF({ ...f, competitor: e.target.value })} placeholder="Nome da confeitaria" maxLength={80} />
        </Field>
        <Field label="Tamanho equivalente" error={touched ? errs.variant : null} hint={product.variants.length > 1 ? 'Compare só o mesmo tamanho (unidade com unidade, caixa com caixa)' : undefined}>
          <Select value={f.variantId} onChange={(e) => setF({ ...f, variantId: e.target.value ? Number(e.target.value) : '' })}>
            {product.variants.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </Select>
        </Field>
        <Field label="Preço" error={touched ? errs.price : null}>
          <NumInput value={f.price} onChange={(v) => setF({ ...f, price: v })} prefix="R$" />
        </Field>
        <Field label="Data em que viu" error={touched ? errs.observedAt : null}>
          <Input type="date" value={f.observedAt} min="2000-01-01" max={todayISO()} onChange={(e) => setF({ ...f, observedAt: e.target.value })} />
        </Field>
        <Field label="Região / bairro">
          <Input value={f.region} onChange={(e) => setF({ ...f, region: e.target.value })} maxLength={80} />
        </Field>
        <Field label="Fonte" error={touched ? errs.source : null} hint="Link do cardápio, perfil, iFood, ou “visita à loja”">
          <Input value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} maxLength={300} />
        </Field>
        <Field label="Observações" className="sm:col-span-2">
          <Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} maxLength={500} placeholder="Peso, sabor, se é gourmet…" className="min-h-[52px]" />
        </Field>
        <div className="sm:col-span-2"><Badge>Mínimo de {MARKET_MIN_SAMPLES} preços para gerar a comparação</Badge></div>
      </form>
    </Modal>
  );
}
