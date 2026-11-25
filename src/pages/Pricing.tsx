import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Calculator, Save } from 'lucide-react';
import { useStore } from '../lib/store.tsx';
import { api } from '../lib/api.ts';
import { marketStats, priceForMargin, pricing, roundUp, safeVariantCost, unitProfit, unitsForProfit, type Pricing, type VariantCost } from '../../shared/calc.ts';
import type { Product } from '../../shared/types.ts';
import { money, number, parseNum, pct, toField } from '../lib/format.ts';
import { CostBars, CurrentPriceBadge, PriceTiers } from '../components/PricingPanel.tsx';
import { marketEntriesFor, MARKET_MAX_AGE_DAYS } from '../lib/market.ts';
import { Badge, Button, Card, cx, Empty, Field, Modal, Notice, NumInput, PageHeader, SearchInput, TableWrap, Td, Th, useFeedback } from '../components/ui.tsx';

export interface Row {
  product: Product;
  variant: Product['variants'][number];
  cost: VariantCost | null;
  error: string | null;
  pricing: Pricing | null;
}

export function usePricingRows(): Row[] {
  const { products, ctx } = useStore();
  return useMemo(
    () =>
      products.flatMap((p) =>
        p.variants.map((v) => {
          const { cost, error } = safeVariantCost(v, ctx);
          return {
            product: p,
            variant: v,
            cost,
            error,
            pricing: cost ? pricing(cost.breakdown.total, ctx.settings, { targetMargin: v.targetMargin, salePrice: v.salePrice }) : null,
          };
        }),
      ),
    [products, ctx],
  );
}

export default function PricingPage() {
  const rows = usePricingRows();
  const { settings } = useStore();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const selectedId = Number(params.get('v')) || null;
  const selected = rows.find((r) => r.variant.id === selectedId) ?? null;

  const notConfigured = settings.laborMonthly === 0 && settings.fixedCosts.length === 0 && settings.energyMonthly + settings.gasMonthly + settings.waterMonthly === 0;
  const list = rows.filter((r) => !q || `${r.product.name} ${r.variant.name}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <PageHeader
        title="Precificação"
        description="Quanto cobrar por cada produto, considerando ingredientes, embalagens, desperdício, mão de obra, energia, gás, água, despesas fixas, taxas e a margem de lucro."
      />
      {notConfigured && (
        <Notice tone="warn" className="mb-4">
          Mão de obra, contas e despesas fixas ainda não foram informadas, então os preços consideram só ingredientes e embalagens.{' '}
          <Link to="/configuracoes" className="font-medium underline">Configurar custos</Link>
        </Notice>
      )}
      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <SearchInput value={q} onChange={setQ} placeholder="Buscar produto" />
          <div className="ml-auto text-[12.5px] text-muted">
            Margem padrão {pct(settings.targetMarginPct, 0)} · Taxas + impostos {pct(settings.avgFeePct + settings.taxPct)}
          </div>
        </div>
        {rows.length === 0 ? (
          <Empty icon={<Calculator className="size-5" />} title="Nenhum produto para precificar" description="Cadastre produtos para ver os preços sugeridos." action={<Link to="/produtos"><Button variant="primary">Ir para produtos</Button></Link>} />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Produto</Th>
                <Th align="right">Custo</Th>
                <Th align="right" className="hidden md:table-cell">Mínimo</Th>
                <Th align="right">Recomendado</Th>
                <Th align="right" className="hidden lg:table-cell">Margem maior</Th>
                <Th align="right">Meu preço</Th>
                <Th align="right" className="hidden sm:table-cell">Lucro/un</Th>
                <Th className="hidden sm:table-cell">Situação</Th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.variant.id} className="cursor-pointer hover:bg-subtle/50" onClick={() => setParams({ v: String(r.variant.id) })}>
                  <Td>
                    <div className="font-medium">
                      {r.product.name} {!r.product.active && <Badge className="ml-1 align-middle">Inativo</Badge>}
                    </div>
                    <div className="text-[12px] text-muted">{r.variant.name}</div>
                  </Td>
                  {r.pricing ? (
                    <>
                      <Td align="right">{money(r.pricing.cost)}</Td>
                      <Td align="right" className="hidden text-ink-2 md:table-cell">{money(r.pricing.minimum)}</Td>
                      <Td align="right" className="font-semibold">{money(r.pricing.recommended)}</Td>
                      <Td align="right" className="hidden text-ink-2 lg:table-cell">{money(r.pricing.premium)}</Td>
                      <Td align="right">{r.variant.salePrice ? money(r.variant.salePrice) : <span className="text-faint">—</span>}</Td>
                      <Td align="right" className={cx('hidden sm:table-cell', r.pricing.current && r.pricing.current.profit < 0 && 'text-neg')}>
                        {r.pricing.current ? money(r.pricing.current.profit) : <span className="text-faint">—</span>}
                      </Td>
                      <Td className="hidden sm:table-cell"><CurrentPriceBadge p={r.pricing} /></Td>
                    </>
                  ) : (
                    <Td className="text-neg" align="left"><span className="text-[12.5px]">{r.error}</span></Td>
                  )}
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>
      {selected && <PricingDetail row={selected} onClose={() => setParams({})} />}
    </>
  );
}

function PricingDetail({ row, onClose }: { row: Row; onClose: () => void }) {
  const { settings, market, products, reload } = useStore();
  const { toast } = useFeedback();
  const p = row.pricing;
  const [margin, setMargin] = useState(String(p?.marginPct ?? settings.targetMarginPct));
  const [price, setPrice] = useState(toField(row.variant.salePrice ?? p?.recommended ?? null));
  const [goal, setGoal] = useState('1000');
  const [saving, setSaving] = useState(false);

  if (!p || !row.cost) {
    return (
      <Modal open onClose={onClose} title={`${row.product.name} · ${row.variant.name}`}>
        <Notice tone="neg">{row.error}</Notice>
      </Modal>
    );
  }

  const m = parseNum(margin);
  const simPriceRaw = m >= 0 ? priceForMargin(p.cost, p.deductionsPct, m) : null;
  const simPrice = simPriceRaw === null ? null : roundUp(simPriceRaw, settings.roundTo);
  const priceNum = parseNum(price);
  const profitAtPrice = priceNum > 0 ? unitProfit(priceNum, p.cost, p.deductionsPct) : null;
  const goalNum = parseNum(goal);
  const units = profitAtPrice !== null && goalNum >= 0 ? unitsForProfit(goalNum, profitAtPrice) : null;

  const mk = marketEntriesFor(market, row.product, row.variant.id);
  const stats = marketStats(mk.map((x) => x.price));

  const savePrice = async () => {
    if (!(priceNum > 0)) return;
    setSaving(true);
    try {
      const prod = products.find((x) => x.id === row.product.id)!;
      await api.put(`/products/${prod.id}`, {
        ...prod,
        expectedUpdatedAt: prod.updatedAt,
        variants: prod.variants.map((v) => (v.id === row.variant.id ? { ...v, salePrice: Math.round(priceNum * 100) / 100 } : v)),
      });
      await reload('products');
      toast('Preço de venda atualizado.');
    } catch (e) {
      toast((e as Error).message, 'neg');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} size="xl" title={`${row.product.name} · ${row.variant.name}`} description="Composição do custo, preços sugeridos e simulação.">
      <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        <div className="space-y-4">
          <div className="rounded-xl border border-line bg-subtle/60 p-4">
            <div className="text-[12.5px] font-medium text-muted">Custo total de produção</div>
            <div className="num mt-1 text-[26px] font-semibold tracking-[-0.02em]">{money(p.cost)}</div>
            <div className="mt-4 border-t border-line pt-4"><CostBars b={row.cost.breakdown} /></div>
          </div>
          <div className="rounded-xl border border-line p-4 text-[12.5px]">
            <div className="mb-2 font-medium text-ink-2">Composição</div>
            <ul className="space-y-1.5">
              {row.cost.components.map((c, i) => (
                <li key={i} className="flex justify-between gap-2"><span className="truncate text-muted">{number(c.fraction, 3)} × {c.name}</span><span className="num">{money(c.cost)}</span></li>
              ))}
              {row.cost.items.map((l, i) => (
                <li key={`i${i}`} className="flex justify-between gap-2"><span className="truncate text-muted">{number(l.quantity, 3)} {l.unit} {l.name}</span><span className="num">{money(l.cost)}</span></li>
              ))}
            </ul>
          </div>
        </div>

        <div className="space-y-5">
          <PriceTiers p={p} />
          {p.recommendedProfit !== null && (
            <div className="grid grid-cols-2 gap-3 text-[12.5px] sm:grid-cols-4">
              <Mini label="Lucro por unidade (recomendado)" value={money(p.recommendedProfit)} />
              <Mini label="Margem percentual" value={pct(p.recommended ? (p.recommendedProfit / p.recommended) * 100 : null)} />
              <Mini label="Taxas + impostos" value={pct(p.deductionsPct)} />
              <Mini label="Markup sobre custo" value={p.recommended && p.cost > 0 ? `${number(p.recommended / p.cost, 2)}×` : '—'} />
            </div>
          )}

          <Card title="Simulador">
            <div className="grid gap-5 md:grid-cols-3">
              <div>
                <Field label="Se eu quiser margem de…">
                  <NumInput value={margin} onChange={setMargin} suffix="%" />
                </Field>
                <div className="mt-2 text-[12.5px] text-muted">Preço necessário</div>
                <div className="num text-[18px] font-semibold">{simPrice === null ? <span className="text-[13px] text-neg">Margem impossível</span> : money(simPrice)}</div>
              </div>
              <div>
                <Field label="Se eu cobrar…">
                  <NumInput value={price} onChange={setPrice} prefix="R$" />
                </Field>
                <div className="mt-2 text-[12.5px] text-muted">Lucro por unidade / margem</div>
                <div className={cx('num text-[18px] font-semibold', profitAtPrice !== null && profitAtPrice < 0 && 'text-neg')}>
                  {profitAtPrice === null ? '—' : <>{money(profitAtPrice)} <span className="text-[13px] font-medium text-muted">{pct((profitAtPrice / priceNum) * 100)}</span></>}
                </div>
                {priceNum > 0 && priceNum !== row.variant.salePrice && (
                  <Button size="sm" className="mt-2" icon={<Save className="size-3.5" />} loading={saving} onClick={savePrice}>Usar como meu preço</Button>
                )}
              </div>
              <div>
                <Field label="Quero lucrar no mês…">
                  <NumInput value={goal} onChange={setGoal} prefix="R$" />
                </Field>
                <div className="mt-2 text-[12.5px] text-muted">Unidades a vender (no preço ao lado)</div>
                <div className="num text-[18px] font-semibold">
                  {profitAtPrice !== null && profitAtPrice <= 0 ? <span className="text-[13px] text-neg">Sem lucro nesse preço</span> : units === null ? '—' : `${number(units, 0)} un`}
                </div>
              </div>
            </div>
            <p className="mt-4 text-[12px] text-muted">
              Lucro = preço − {pct(p.deductionsPct)} de taxas e impostos − custo de produção. Mão de obra e despesas fixas já estão no custo, então este é o lucro além do seu pró-labore.
            </p>
          </Card>

          <Card title="Mercado" action={<Link to={`/mercado?p=${row.product.id}`} className="text-[12.5px] font-medium text-accent hover:underline">Ver / adicionar preços</Link>}>
            {stats ? (
              <div className="grid grid-cols-2 gap-3 text-[12.5px] sm:grid-cols-4">
                <Mini label="Faixa encontrada" value={`${money(stats.min)} – ${money(stats.max)}`} />
                <Mini label="Mediana" value={money(stats.median)} />
                <Mini label="Faixa central" value={`${money(stats.p25)} – ${money(stats.p75)}`} />
                <Mini label="Amostras" value={`${stats.count}`} />
              </div>
            ) : (
              <p className="text-[13px] text-muted">
                Comparação indisponível: {mk.length === 0 ? `nenhum preço de concorrente deste tamanho nos últimos ${MARKET_MAX_AGE_DAYS} dias` : `apenas ${mk.length} preço(s) deste tamanho; são necessários pelo menos 3`}.
              </p>
            )}
          </Card>
          {row.variant.targetMargin !== null && <Badge tone="accent">Este tamanho usa margem própria de {pct(row.variant.targetMargin, 0)}</Badge>}
        </div>
      </div>
    </Modal>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line px-3 py-2">
      <div className="text-[11.5px] text-muted">{label}</div>
      <div className="num mt-0.5 text-[14px] font-semibold">{value}</div>
    </div>
  );
}
