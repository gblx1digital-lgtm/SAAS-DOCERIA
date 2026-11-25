import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Pencil, Plus, ShoppingBag, Trash2, Wallet } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useStore } from '../lib/store.tsx';
import { api } from '../lib/api.ts';
import { baseUnitOf, compatibleUnits } from '../../shared/calc.ts';
import { PAYMENT_LABEL, TX_CATEGORY_LABEL, type PaymentMethod, type Transaction, type TxCategory, type Unit } from '../../shared/types.ts';
import { date, money, number, parseNum, toField, todayISO } from '../lib/format.ts';
import { bucketLabel, PeriodPicker, usePeriod } from '../components/Period.tsx';
import type { Dashboard } from '../../server/dashboard.ts';
import {
  Badge, Button, Card, cx, Empty, Field, IconButton, Input, Modal, Notice, NumInput, PageHeader, Select, Stat, TableWrap, Td, Th, useFeedback,
} from '../components/ui.tsx';
import { IngredientSelect } from '../components/LineEditor.tsx';

type FormKind = 'venda' | 'compra' | 'outro';

export function useFinance(from: string, to: string, gran: string) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, t] = await Promise.all([
        api.get<Dashboard>(`/dashboard?from=${from}&to=${to}&granularity=${gran}`),
        api.get<Transaction[]>(`/transactions?from=${from}&to=${to}`),
      ]);
      setData(d);
      setTxs(t);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [from, to, gran]);
  useEffect(() => { load(); }, [load]);
  return { data, txs, error, loading, load };
}

export default function Finance() {
  const [period, setPeriod] = usePeriod();
  const { data, txs, error, load } = useFinance(period.from, period.to, period.gran);
  const [form, setForm] = useState<{ kind: FormKind; tx?: Transaction } | null>(null);
  const [filter, setFilter] = useState<'' | TxCategory>('');
  const { toast, confirm } = useFeedback();
  const { reload, settings } = useStore();

  const list = filter ? txs.filter((t) => t.category === filter) : txs;
  const t = data?.totals;

  const remove = async (tx: Transaction) => {
    if (!(await confirm({ title: 'Excluir lançamento', message: <>Excluir <b>{tx.description}</b> de {money(tx.amount)}?</>, confirmLabel: 'Excluir', danger: true }))) return;
    try {
      await api.del(`/transactions/${tx.id}`);
      await load();
      toast('Lançamento excluído.');
    } catch (e) {
      toast((e as Error).message, 'neg');
    }
  };

  const chart = useMemo(() => (data?.series ?? []).map((s) => ({ ...s, label: bucketLabel(s.bucket, period.gran) })), [data, period.gran]);

  return (
    <>
      <PageHeader
        title="Financeiro"
        description="Vendas, compras de ingredientes, despesas fixas e variáveis. Cada venda guarda o custo de produção do momento, para calcular o lucro real."
        actions={
          <>
            <Button icon={<Plus className="size-4" />} onClick={() => setForm({ kind: 'outro' })}>Despesa / entrada</Button>
            <Button icon={<ShoppingBag className="size-4" />} onClick={() => setForm({ kind: 'compra' })}>Compra</Button>
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setForm({ kind: 'venda' })}>Registrar venda</Button>
          </>
        }
      />
      <div className="mb-5"><PeriodPicker value={period} onChange={setPeriod} /></div>
      {error && <Notice tone="neg" className="mb-4">{error}</Notice>}

      {t && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Entradas" value={money(t.cashIn)} hint={`${t.salesCount} venda(s) · já sem taxas`} />
            <Stat label="Saídas" value={money(t.cashOut)} hint={`Compras ${money(t.purchases)} · despesas ${money(t.expenses)}`} />
            <Stat label="Saldo de caixa" value={money(t.cashBalance)} tone={t.cashBalance >= 0 ? 'pos' : 'neg'} hint="Entradas − saídas" />
            <Stat label={t.estimatedProfit >= 0 ? 'Lucro estimado' : 'Prejuízo estimado'} value={money(t.estimatedProfit)} tone={t.estimatedProfit >= 0 ? 'pos' : 'neg'} hint="Vendas − custo dos produtos − taxas − impostos − despesas" />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <Card title="Fluxo de caixa" subtitle="Entradas e saídas no período">
              {chart.every((c) => !c.entradas && !c.saidas) ? (
                <Empty title="Sem lançamentos no período" />
              ) : (
                <div className="h-64">
                  <ResponsiveContainer>
                    <BarChart data={chart} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barGap={2}>
                      <CartesianGrid stroke="#e7e5e4" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#78716c' }} tickLine={false} axisLine={false} minTickGap={12} />
                      <YAxis tick={{ fontSize: 11, fill: '#78716c' }} tickLine={false} axisLine={false} width={72} tickFormatter={(v) => money(v)} />
                      <Tooltip formatter={(v, n) => [money(Number(v)), n === 'entradas' ? 'Entradas' : 'Saídas']} cursor={{ fill: '#f5f5f4' }} contentStyle={{ borderRadius: 8, border: '1px solid #e7e5e4', fontSize: 12 }} />
                      <Legend formatter={(v) => (v === 'entradas' ? 'Entradas' : 'Saídas')} iconType="square" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="entradas" fill="#1c1917" radius={[3, 3, 0, 0]} maxBarSize={28} />
                      <Bar dataKey="saidas" fill="#b8b2ad" radius={[3, 3, 0, 0]} maxBarSize={28} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>
            <Card title="Resultado do período">
              <dl className="space-y-2 text-[13px]">
                <Line label="Vendas" value={t.salesRevenue} />
                <Line label="Outras entradas" value={t.otherIncome} />
                <Line label="Taxas de pagamento" value={-t.fees} />
                <Line label="Impostos estimados" value={-t.taxes} />
                <Line label="Custo dos produtos vendidos" value={-t.cogs} />
                <Line label="Despesas fixas" value={-t.fixedExpenses} />
                <Line label="Despesas variáveis" value={-t.variableExpenses} />
                <Line label="Outras saídas" value={-t.otherExpenses} />
                <div className="flex justify-between border-t border-line pt-2 font-semibold">
                  <dt>{t.estimatedProfit >= 0 ? 'Lucro' : 'Prejuízo'}</dt>
                  <dd className={cx('num', t.estimatedProfit >= 0 ? 'text-pos' : 'text-neg')}>{money(t.estimatedProfit)}</dd>
                </div>
              </dl>
              <p className="mt-3 text-[11.5px] text-muted">
                Compras de ingredientes ({money(t.purchases)}) entram no caixa, mas no resultado o que conta é o custo dos ingredientes usados nos produtos vendidos, para não contar duas vezes.
              </p>
            </Card>
          </div>
        </>
      )}

      <Card className="mt-4" padded={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <h3 className="text-[13.5px] font-semibold">Lançamentos</h3>
          <div className="ml-auto w-56"><Select value={filter} onChange={(e) => setFilter(e.target.value as TxCategory | '')}>
            <option value="">Todas as categorias</option>
            {Object.entries(TX_CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select></div>
        </div>
        {list.length === 0 ? (
          <Empty icon={<Wallet className="size-5" />} title="Nenhum lançamento neste período" description="Registre vendas, compras e despesas para acompanhar o desempenho." />
        ) : (
          <TableWrap>
            <thead>
              <tr><Th>Data</Th><Th>Descrição</Th><Th className="hidden md:table-cell">Categoria</Th><Th align="right">Valor</Th><Th align="right" className="hidden sm:table-cell">Lucro</Th><Th /></tr>
            </thead>
            <tbody>
              {list.map((tx) => {
                const profit = tx.category === 'venda' && tx.unitCost !== null && tx.quantity !== null
                  ? tx.amount - tx.fee - (tx.amount * settings.taxPct) / 100 - tx.unitCost * tx.quantity
                  : null;
                return (
                  <tr key={tx.id} className="hover:bg-subtle/50">
                    <Td className="whitespace-nowrap text-ink-2">{date(tx.date)}</Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <span className={cx('flex size-6 shrink-0 items-center justify-center rounded-md', tx.type === 'entrada' ? 'bg-pos-soft text-pos' : 'bg-subtle text-muted')}>
                          {tx.type === 'entrada' ? <ArrowDownLeft className="size-3.5" /> : <ArrowUpRight className="size-3.5" />}
                        </span>
                        <div className="min-w-0">
                          <div className="truncate font-medium">{tx.description}</div>
                          <div className="text-[11.5px] text-muted">
                            {tx.quantity ? `${number(tx.quantity)} un · ` : ''}
                            {tx.paymentMethod ? PAYMENT_LABEL[tx.paymentMethod] : ''}
                            {tx.fee ? ` · taxa ${money(tx.fee)}` : ''}
                          </div>
                        </div>
                      </div>
                    </Td>
                    <Td className="hidden md:table-cell"><Badge tone={tx.type === 'entrada' ? 'pos' : 'neutral'}>{TX_CATEGORY_LABEL[tx.category]}</Badge></Td>
                    <Td align="right" className={cx('font-medium', tx.type === 'saida' && 'text-ink-2')}>{tx.type === 'saida' ? '−' : ''}{money(tx.amount)}</Td>
                    <Td align="right" className={cx('hidden sm:table-cell', profit !== null && profit < 0 && 'text-neg')}>{profit === null ? <span className="text-faint">—</span> : money(profit)}</Td>
                    <Td className="w-px whitespace-nowrap">
                      <div className="flex justify-end gap-0.5">
                        <IconButton label="Editar" onClick={() => setForm({ kind: tx.category === 'venda' ? 'venda' : tx.category === 'compra_ingrediente' ? 'compra' : 'outro', tx })}><Pencil className="size-4" /></IconButton>
                        <IconButton label="Excluir" className="hover:text-neg" onClick={() => remove(tx)}><Trash2 className="size-4" /></IconButton>
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
      </Card>

      {form && (
        <TxForm
          kind={form.kind}
          initial={form.tx}
          onClose={() => setForm(null)}
          onSaved={async (touchedIngredients) => {
            await load();
            if (touchedIngredients) await reload('ingredients', 'history');
          }}
        />
      )}
    </>
  );
}

function Line({ label, value }: { label: string; value: number }) {
  if (Math.abs(value) < 0.005 && label !== 'Vendas') return null;
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className={cx('num', value < 0 ? 'text-ink-2' : 'text-ink')}>{value < 0 ? `− ${money(-value)}` : money(value)}</dd>
    </div>
  );
}

// ───────── Formulário de lançamento ─────────

export function TxForm({ kind, initial, onClose, onSaved }: { kind: FormKind; initial?: Transaction; onClose: () => void; onSaved: (touchedIngredients: boolean) => void | Promise<void> }) {
  const { products, ingredients, settings, ctx } = useStore();
  const { toast } = useFeedback();
  const activeProducts = products.filter((p) => p.active || p.id === initial?.productId);
  const [f, setF] = useState({
    date: initial?.date ?? todayISO(),
    category: (initial?.category ?? (kind === 'outro' ? 'despesa_variavel' : kind === 'compra' ? 'compra_ingrediente' : 'venda')) as TxCategory,
    description: initial?.description ?? '',
    amount: toField(initial?.amount),
    productId: (initial?.productId ?? activeProducts[0]?.id ?? '') as number | '',
    variantId: (initial?.variantId ?? '') as number | '',
    quantity: toField(initial?.quantity ?? 1),
    unitPrice: initial && initial.quantity ? toField(Math.round((initial.amount / initial.quantity) * 100) / 100) : '',
    paymentMethod: (initial?.paymentMethod ?? 'pix') as PaymentMethod,
    fee: initial ? toField(initial.fee) : '',
    feeEdited: !!initial,
    ingredientId: (initial?.ingredientId ?? '') as number | '',
    updateIngredient: !initial,
    packs: '1',
    packageSize: '',
    unit: 'g' as Unit,
  });
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<typeof f>) => setF((s) => ({ ...s, ...patch }));

  const product = products.find((p) => p.id === f.productId);
  const variant = product?.variants.find((v) => v.id === f.variantId);

  // Preenchimentos automáticos
  useEffect(() => {
    if (kind !== 'venda' || !product) return;
    if (!product.variants.some((v) => v.id === f.variantId)) set({ variantId: product.variants[0]?.id ?? '' });
  }, [kind, product]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (kind !== 'venda' || !variant || initial) return;
    if (variant.salePrice) set({ unitPrice: toField(variant.salePrice) });
  }, [variant?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (kind !== 'compra' || f.ingredientId === '') return;
    const ing = ctx.ingredients.get(f.ingredientId);
    if (ing) set({ packs: toField(ing.packs), packageSize: toField(ing.packageSize), unit: ing.unit });
  }, [f.ingredientId]); // eslint-disable-line react-hooks/exhaustive-deps

  const qty = parseNum(f.quantity);
  const unitPrice = parseNum(f.unitPrice);
  const saleTotal = qty > 0 && unitPrice >= 0 ? Math.round(qty * unitPrice * 100) / 100 : NaN;
  const amount = kind === 'venda' ? saleTotal : parseNum(f.amount);
  const feePct = f.paymentMethod === 'pix' ? settings.feePixPct : f.paymentMethod === 'debito' ? settings.feeDebitPct : f.paymentMethod === 'credito' ? settings.feeCreditPct : 0;
  const autoFee = amount > 0 ? Math.round(amount * feePct) / 100 : 0;
  const fee = f.feeEdited && f.fee.trim() ? parseNum(f.fee) : autoFee;

  const errs: Record<string, string | null> = {
    date: !f.date ? 'Informe a data.' : null,
    amount: kind === 'venda' ? (!(unitPrice >= 0) || !f.unitPrice.trim() ? 'Informe o preço.' : null) : !(amount > 0) ? 'Informe o valor.' : null,
    quantity: kind === 'venda' && !(qty > 0) ? 'Quantidade inválida.' : null,
    product: kind === 'venda' && (!product || !variant) ? 'Selecione o produto.' : null,
    description: kind === 'outro' && !f.description.trim() ? 'Descreva o lançamento.' : kind === 'compra' && f.ingredientId === '' && !f.description.trim() ? 'Selecione o ingrediente ou descreva a compra.' : null,
    fee: kind === 'venda' && !(fee >= 0) ? 'Taxa inválida.' : null,
    pack: kind === 'compra' && f.ingredientId !== '' && f.updateIngredient && (!(parseNum(f.packs) > 0) || !(parseNum(f.packageSize) > 0)) ? 'Informe quantidade e conteúdo.' : null,
  };
  const valid = Object.values(errs).every((e) => !e);

  const submit = async () => {
    setTouched(true);
    if (!valid) return;
    setSaving(true);
    setError(null);
    let body: Record<string, unknown>;
    if (kind === 'venda') {
      body = { category: 'venda', date: f.date, productId: f.productId, variantId: f.variantId, quantity: qty, amount: saleTotal, paymentMethod: f.paymentMethod, fee, description: f.description };
    } else if (kind === 'compra') {
      body = {
        category: 'compra_ingrediente', date: f.date, amount, description: f.description, ingredientId: f.ingredientId === '' ? null : f.ingredientId, paymentMethod: f.paymentMethod,
        updateIngredient: f.ingredientId !== '' && f.updateIngredient ? { packs: parseNum(f.packs), packageSize: parseNum(f.packageSize), unit: f.unit } : null,
      };
    } else {
      body = { category: f.category, date: f.date, amount, description: f.description, paymentMethod: f.paymentMethod };
    }
    try {
      if (initial) await api.put(`/transactions/${initial.id}`, body);
      else await api.post('/transactions', body);
      await onSaved(kind === 'compra' && !!body.updateIngredient);
      toast(initial ? 'Lançamento atualizado.' : kind === 'venda' ? 'Venda registrada.' : 'Lançamento registrado.');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const title = initial ? 'Editar lançamento' : kind === 'venda' ? 'Registrar venda' : kind === 'compra' ? 'Compra de ingredientes' : 'Despesa ou entrada';
  const ing = f.ingredientId === '' ? undefined : ctx.ingredients.get(f.ingredientId);

  return (
    <Modal open onClose={onClose} title={title} footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={saving} onClick={submit}>{initial ? 'Salvar' : 'Registrar'}</Button></>}>
      <form className="grid grid-cols-1 gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <button type="submit" hidden />
        {error && <Notice tone="neg" className="sm:col-span-2">{error}</Notice>}

        {kind === 'venda' && (
          activeProducts.length === 0 ? (
            <Notice tone="warn" className="sm:col-span-2">Cadastre um produto antes de registrar vendas.</Notice>
          ) : (
            <>
              <Field label="Produto" error={touched ? errs.product : null}>
                <Select value={f.productId} onChange={(e) => set({ productId: Number(e.target.value) })}>
                  {activeProducts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </Field>
              <Field label="Tamanho">
                <Select value={f.variantId} onChange={(e) => set({ variantId: Number(e.target.value) })}>
                  {product?.variants.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </Select>
              </Field>
              <Field label="Quantidade" error={touched ? errs.quantity : null}>
                <NumInput value={f.quantity} onChange={(v) => set({ quantity: v })} />
              </Field>
              <Field label="Preço unitário" error={touched ? errs.amount : null} hint={variant && !variant.salePrice ? 'Defina “meu preço” no produto para preencher automaticamente.' : undefined}>
                <NumInput value={f.unitPrice} onChange={(v) => set({ unitPrice: v })} prefix="R$" />
              </Field>
            </>
          )
        )}

        {kind === 'compra' && (
          <>
            <Field label="Ingrediente" hint="Opcional — deixe vazio para compras gerais" className="sm:col-span-2">
              <IngredientSelect value={f.ingredientId} onChange={(id) => set({ ingredientId: id })} />
            </Field>
            {ing && !initial && (
              <div className="rounded-lg border border-line bg-subtle/50 p-3 sm:col-span-2">
                <label className="flex items-center gap-2 text-[13px] font-medium">
                  <input type="checkbox" checked={f.updateIngredient} onChange={(e) => set({ updateIngredient: e.target.checked })} className="accent-[#1c1917]" />
                  Atualizar o preço de {ing.name} com esta compra
                </label>
                {f.updateIngredient && (
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <Field label="Embalagens"><NumInput value={f.packs} onChange={(v) => set({ packs: v })} /></Field>
                    <Field label="Conteúdo"><NumInput value={f.packageSize} onChange={(v) => set({ packageSize: v })} /></Field>
                    <Field label="Unidade">
                      <Select value={f.unit} onChange={(e) => set({ unit: e.target.value as Unit })}>
                        {compatibleUnits(ing.unit).map((u) => <option key={u}>{u}</option>)}
                      </Select>
                    </Field>
                    {touched && errs.pack && <div className="col-span-3 text-[12px] text-neg">{errs.pack}</div>}
                    {amount > 0 && parseNum(f.packs) > 0 && parseNum(f.packageSize) > 0 && (
                      <div className="col-span-3 text-[12px] text-muted">
                        Novo custo: {money(amount / (parseNum(f.packs) * parseNum(f.packageSize) * (f.unit === 'kg' || f.unit === 'l' ? 1000 : 1)) * (baseUnitOf(f.unit) === 'un' ? 1 : 1000))} por {baseUnitOf(f.unit) === 'g' ? 'kg' : baseUnitOf(f.unit) === 'ml' ? 'L' : 'un'}. Receitas e produtos serão recalculados.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {kind === 'outro' && (
          <Field label="Tipo" className="sm:col-span-2">
            <Select value={f.category} onChange={(e) => set({ category: e.target.value as TxCategory })}>
              <option value="despesa_fixa">Despesa fixa (aluguel, internet, MEI…)</option>
              <option value="despesa_variavel">Despesa variável (gás, entrega, manutenção…)</option>
              <option value="outra_saida">Outra saída</option>
              <option value="outra_entrada">Outra entrada</option>
            </Select>
          </Field>
        )}

        {kind !== 'venda' && (
          <Field label="Valor" error={touched ? errs.amount : null}>
            <NumInput value={f.amount} onChange={(v) => set({ amount: v })} prefix="R$" />
          </Field>
        )}
        <Field label="Data" error={touched ? errs.date : null}>
          <Input type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} />
        </Field>
        <Field label="Forma de pagamento">
          <Select value={f.paymentMethod} onChange={(e) => set({ paymentMethod: e.target.value as PaymentMethod, feeEdited: false, fee: '' })}>
            {Object.entries(PAYMENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        {kind === 'venda' && (
          <Field label="Taxa cobrada" error={touched ? errs.fee : null} hint={!f.feeEdited ? `Automática: ${number(feePct)}% (configurações)` : undefined}>
            <NumInput value={f.feeEdited ? f.fee : toField(autoFee)} onChange={(v) => set({ fee: v, feeEdited: true })} prefix="R$" />
          </Field>
        )}
        <Field label="Descrição" error={touched ? errs.description : null} className="sm:col-span-2" hint={kind === 'venda' ? 'Opcional (cliente, encomenda…)' : undefined}>
          <Input value={f.description} onChange={(e) => set({ description: e.target.value })} maxLength={200} />
        </Field>

        {kind === 'venda' && saleTotal > 0 && (
          <div className="flex items-baseline justify-between rounded-lg border border-line bg-subtle/50 px-3 py-2.5 sm:col-span-2">
            <span className="text-[12.5px] text-muted">Total da venda{fee > 0 ? ` (você recebe ${money(saleTotal - fee)})` : ''}</span>
            <span className="num text-[17px] font-semibold">{money(saleTotal)}</span>
          </div>
        )}
        {ingredients.length === 0 && kind === 'compra' && <Notice className="sm:col-span-2">Nenhum ingrediente cadastrado; registre como compra geral com descrição.</Notice>}
      </form>
    </Modal>
  );
}
