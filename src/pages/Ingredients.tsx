import { useMemo, useState } from 'react';
import { History, Pencil, Plus, Trash2, TrendingDown, TrendingUp, Wheat } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useStore } from '../lib/store.tsx';
import { api } from '../lib/api.ts';
import { baseUnitOf, costPerBase } from '../../shared/calc.ts';
import { INGREDIENT_CATEGORIES, UNITS, type Ingredient, type Unit } from '../../shared/types.ts';
import { date, money, moneyPrecise, number, parseNum, pct, toField, todayISO } from '../lib/format.ts';
import {
  Badge, Button, Card, Empty, Field, IconButton, Input, Modal, Notice, NumInput, PageHeader, SearchInput, Select, TableWrap, Td, Textarea, Th, useDirty, useFeedback,
} from '../components/ui.tsx';

const UNIT_LABEL: Record<Unit, string> = { g: 'gramas (g)', kg: 'quilos (kg)', ml: 'mililitros (ml)', l: 'litros (L)', un: 'unidades (un)' };
const UNIT_WORD: Record<Unit, [string, string]> = { g: ['g', 'g'], kg: ['kg', 'kg'], ml: ['ml', 'ml'], l: ['litro', 'litros'], un: ['unidade', 'unidades'] };
const SIZE_EXAMPLE: Record<Unit, string> = {
  un: 'Ex.: cartela com 30 ovos → 30',
  g: 'Ex.: lata de 395 g → 395',
  kg: 'Ex.: pacote de 1 kg → 1',
  ml: 'Ex.: caixa de 200 ml → 200',
  l: 'Ex.: garrafa de 1 litro → 1',
};
/** Categorias normalmente compradas por unidade. */
const UNIT_CATEGORIES = new Set(['Ovos', 'Embalagens']);
const qty = (v: number, u: Unit) => `${number(v, 3)} ${UNIT_WORD[u][v === 1 ? 0 : 1]}`;

/** Variação do custo por unidade base entre a penúltima e a última compra. */
export function useLastChange() {
  const { history } = useStore();
  return useMemo(() => {
    const m = new Map<number, number>();
    const by = new Map<number, typeof history>();
    for (const h of history) by.set(h.ingredientId, [...(by.get(h.ingredientId) ?? []), h]);
    for (const [id, arr] of by) {
      if (arr.length < 2) continue;
      const a = arr[arr.length - 2].costPerBase;
      const b = arr[arr.length - 1].costPerBase;
      if (a > 0) m.set(id, ((b - a) / a) * 100);
    }
    return m;
  }, [history]);
}

export default function Ingredients() {
  const { ingredients, recipes, products, settings } = useStore();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [editing, setEditing] = useState<Ingredient | 'new' | null>(null);
  const [historyOf, setHistoryOf] = useState<Ingredient | null>(null);
  const change = useLastChange();
  const { toast, confirm } = useFeedback();
  const { reload } = useStore();

  const usage = useMemo(() => {
    const m = new Map<number, number>();
    for (const r of recipes) for (const it of new Set(r.items.map((i) => i.ingredientId))) m.set(it, (m.get(it) ?? 0) + 1);
    for (const p of products) for (const v of p.variants) for (const it of v.items) m.set(it.ingredientId, (m.get(it.ingredientId) ?? 0) + 1);
    return m;
  }, [recipes, products]);

  const list = ingredients.filter(
    (i) => (!cat || i.category === cat) && (!q || `${i.name} ${i.supplier}`.toLowerCase().includes(q.toLowerCase())),
  );

  const remove = async (i: Ingredient) => {
    if (!(await confirm({ title: 'Excluir ingrediente', message: <>Excluir <b>{i.name}</b> e todo o histórico de preços?</>, confirmLabel: 'Excluir', danger: true })))
      return;
    try {
      await api.del(`/ingredients/${i.id}`);
      await reload('ingredients', 'history');
      toast('Ingrediente excluído.');
    } catch (e) {
      toast((e as Error).message, 'neg');
    }
  };

  return (
    <>
      <PageHeader
        title="Ingredientes"
        description="Cadastre o que você compra e quanto pagou. O custo por grama, mililitro ou unidade é calculado automaticamente e atualiza todas as receitas."
        actions={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>Novo ingrediente</Button>}
      />

      <Card padded={false}>
        <div className="flex flex-col gap-2 border-b border-line p-3 sm:flex-row sm:items-center">
          <SearchInput value={q} onChange={setQ} placeholder="Buscar por nome ou fornecedor" />
          <Select value={cat} onChange={(e) => setCat(e.target.value)} className="sm:w-52">
            <option value="">Todas as categorias</option>
            {INGREDIENT_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </Select>
          <div className="text-[12.5px] text-muted sm:ml-auto">{list.length} de {ingredients.length}</div>
        </div>
        {ingredients.length === 0 ? (
          <Empty
            icon={<Wheat className="size-5" />}
            title="Nenhum ingrediente cadastrado"
            description="Comece pelo que mais usa: leite condensado, creme de leite, chocolate, manteiga, embalagens…"
            action={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>Cadastrar primeiro ingrediente</Button>}
          />
        ) : list.length === 0 ? (
          <Empty title="Nada encontrado" description="Ajuste a busca ou o filtro." />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Ingrediente</Th>
                <Th className="hidden md:table-cell">Fornecedor</Th>
                <Th className="hidden sm:table-cell">Compra</Th>
                <Th align="right" className="hidden sm:table-cell">Valor pago</Th>
                <Th align="right">Custo unitário</Th>
                <Th align="right" className="hidden sm:table-cell">Variação</Th>
                <Th className="hidden lg:table-cell">Última compra</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {list.map((i) => {
                const ch = change.get(i.id);
                const base = baseUnitOf(i.unit);
                return (
                  <tr key={i.id} className="group hover:bg-subtle/50">
                    <Td className="max-w-0 w-full sm:w-auto sm:max-w-none">
                      <div className="truncate font-medium text-ink">{i.name}</div>
                      <div className="truncate text-[12px] text-muted">
                        <span className="sm:hidden">
                          {i.packs !== 1 && `${number(i.packs)} × `}
                          {number(i.packageSize, 3)} {i.unit} por {money(i.totalPrice)} ·{' '}
                        </span>
                        {i.category}
                        {usage.get(i.id) ? ` · em ${usage.get(i.id)} cadastro(s)` : ''}
                      </div>
                    </Td>
                    <Td className="hidden text-ink-2 md:table-cell">{i.supplier || <span className="text-faint">—</span>}</Td>
                    <Td className="num hidden whitespace-nowrap text-ink-2 sm:table-cell">
                      {i.packs !== 1 && `${number(i.packs)} × `}
                      {number(i.packageSize, 3)} {i.unit}
                    </Td>
                    <Td align="right" className="hidden sm:table-cell">{money(i.totalPrice)}</Td>
                    <Td align="right" className="whitespace-nowrap font-medium">
                      {moneyPrecise(costPerBase(i))}
                      <span className="font-normal text-muted">/{base}</span>
                    </Td>
                    <Td align="right" className="hidden sm:table-cell">
                      {ch === undefined || Math.abs(ch) < 0.05 ? (
                        <span className="text-faint">—</span>
                      ) : (
                        <Badge tone={ch >= settings.priceAlertPct ? 'neg' : ch > 0 ? 'warn' : 'pos'}>
                          {ch > 0 ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
                          {ch > 0 ? '+' : ''}
                          {pct(ch)}
                        </Badge>
                      )}
                    </Td>
                    <Td className="hidden whitespace-nowrap text-ink-2 lg:table-cell">{date(i.lastPurchaseDate)}</Td>
                    <Td className="w-px whitespace-nowrap">
                      <div className="flex justify-end gap-0.5">
                        <IconButton label="Histórico de preços" onClick={() => setHistoryOf(i)}><History className="size-4" /></IconButton>
                        <IconButton label="Editar" onClick={() => setEditing(i)}><Pencil className="size-4" /></IconButton>
                        <IconButton label="Excluir" onClick={() => remove(i)} className="hover:text-neg"><Trash2 className="size-4" /></IconButton>
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
      </Card>

      {editing && <IngredientForm initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {historyOf && <HistoryModal ingredient={historyOf} onClose={() => setHistoryOf(null)} />}
    </>
  );
}

export function IngredientForm({ initial, onClose, onSaved }: { initial: Ingredient | null; onClose: () => void; onSaved?: (i: Ingredient) => void }) {
  const { reload } = useStore();
  const { toast } = useFeedback();
  const [f, setF] = useState({
    name: initial?.name ?? '',
    category: initial?.category ?? INGREDIENT_CATEGORIES[0],
    supplier: initial?.supplier ?? '',
    unit: (initial?.unit ?? 'g') as Unit,
    packageSize: toField(initial?.packageSize),
    packs: toField(initial?.packs ?? 1),
    totalPrice: toField(initial?.totalPrice),
    lastPurchaseDate: initial?.lastPurchaseDate ?? todayISO(),
    notes: initial?.notes ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  /** Se a pessoa já escolheu a medida, a categoria não muda mais a medida sozinha. */
  const [unitChosen, setUnitChosen] = useState(!!initial);
  const dirty = useDirty(f);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const setCategory = (category: string) =>
    setF((s) => ({ ...s, category, unit: unitChosen ? s.unit : UNIT_CATEGORIES.has(category) ? 'un' : 'g' }));

  const size = parseNum(f.packageSize);
  const packs = parseNum(f.packs);
  const price = parseNum(f.totalPrice);
  const errs = {
    name: !f.name.trim() ? 'Informe o nome.' : null,
    packageSize: !(size > 0) ? 'Quanto vem em cada embalagem? (número do rótulo)' : null,
    packs: !(packs > 0) ? 'Quantas embalagens? (mínimo 1)' : null,
    totalPrice: !(price >= 0) ? 'Quanto você pagou?' : null,
    lastPurchaseDate: !f.lastPurchaseDate ? 'Informe a data.' : null,
  };
  const valid = Object.values(errs).every((e) => !e);
  const base = baseUnitOf(f.unit);
  const preview = valid ? costPerBase({ unit: f.unit, packageSize: size, packs, totalPrice: price }) : null;

  const submit = async () => {
    if (saving) return;
    setTouched(true);
    if (!valid) return;
    setSaving(true);
    setError(null);
    try {
      const body = { ...f, packageSize: size, packs, totalPrice: price, expectedUpdatedAt: initial?.updatedAt };
      const saved = initial
        ? await api.put<Ingredient>(`/ingredients/${initial.id}`, body)
        : await api.post<Ingredient>('/ingredients', body);
      await reload('ingredients', 'history');
      toast(initial ? 'Ingrediente atualizado. Receitas e produtos recalculados.' : 'Ingrediente cadastrado.');
      onSaved?.(saved);
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
      title={initial ? `Editar ${initial.name}` : 'Novo ingrediente'}
      description="Conte como foi a compra; o sistema calcula quanto custa cada grama ou unidade."
      footerNote={error ?? (touched && !valid ? 'Preencha os campos destacados em vermelho.' : null)}
      dirty={dirty}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" loading={saving} onClick={submit}>{initial ? 'Salvar alterações' : 'Cadastrar'}</Button>
        </>
      }
    >
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="grid grid-cols-1 gap-4 sm:grid-cols-6">
        <button type="submit" hidden />
        {error && <Notice tone="neg" className="sm:col-span-6">{error}</Notice>}
        <Field label="Nome" error={touched ? errs.name : null} className="sm:col-span-4">
          <Input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Ex.: Leite condensado" maxLength={120} invalid={touched && !!errs.name} />
        </Field>
        <Field label="Categoria" className="sm:col-span-2">
          <Select value={f.category} onChange={(e) => setCategory(e.target.value)}>
            {INGREDIENT_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </Select>
        </Field>

        <div className="rounded-lg border border-line bg-subtle/50 p-3 sm:col-span-6">
          <div className="text-[13px] font-semibold text-ink">Como foi a compra?</div>
          <p className="mb-3 mt-0.5 text-[12px] text-muted">Olhe o rótulo da embalagem: lata de 395 g, pacote de 1 kg, cartela com 30 ovos…</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Quantas embalagens comprou?" hint="Latas, pacotes, cartelas…" error={touched ? errs.packs : null}>
              <NumInput value={f.packs} onChange={(v) => set('packs', v)} invalid={touched && !!errs.packs} />
            </Field>
            <Field label="Quanto vem em cada uma?" hint={SIZE_EXAMPLE[f.unit]} error={touched ? errs.packageSize : null}>
              <NumInput value={f.packageSize} onChange={(v) => set('packageSize', v)} placeholder={f.unit === 'un' ? '30' : f.unit === 'g' ? '395' : '1'} invalid={touched && !!errs.packageSize} />
            </Field>
            <Field label="Medida">
              <Select
                value={f.unit}
                onChange={(e) => {
                  setUnitChosen(true);
                  set('unit', e.target.value as Unit);
                }}
              >
                {UNITS.map((u) => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}
              </Select>
            </Field>
            <Field label="Quanto pagou por tudo?" hint="O valor de todas as embalagens juntas" error={touched ? errs.totalPrice : null}>
              <NumInput value={f.totalPrice} onChange={(v) => set('totalPrice', v)} prefix="R$" placeholder="0,00" invalid={touched && !!errs.totalPrice} />
            </Field>
          </div>
          <div className="mt-3 rounded-md border border-line bg-surface px-3 py-2.5 text-[13px] leading-relaxed">
            {preview !== null ? (
              <>
                <div className="text-ink-2">
                  Você comprou <b>{packs === 1 ? '1 embalagem' : `${number(packs)} embalagens`}</b> de <b>{qty(size, f.unit)}</b>
                  {packs !== 1 && <> = <b>{qty(packs * size, f.unit)}</b></>} por <b>{money(price)}</b>.
                </div>
                <div className="mt-0.5 font-semibold text-ink">
                  {base === 'un' ? (
                    <>Cada unidade custa <span className="num">{moneyPrecise(preview)}</span>.</>
                  ) : (
                    <>
                      Cada {base === 'g' ? 'grama' : 'ml'} custa <span className="num">{moneyPrecise(preview)}</span>{' '}
                      <span className="font-normal text-muted">({money(preview * 1000)} o {base === 'g' ? 'quilo' : 'litro'})</span>.
                    </>
                  )}
                </div>
              </>
            ) : (
              <span className="text-muted">Preencha as perguntas acima para ver quanto custa cada {base === 'un' ? 'unidade' : base === 'g' ? 'grama' : 'ml'}.</span>
            )}
          </div>
        </div>

        <Field label="Fornecedor" className="sm:col-span-3">
          <Input value={f.supplier} onChange={(e) => set('supplier', e.target.value)} placeholder="Ex.: Atacadão" maxLength={120} />
        </Field>
        <Field label="Data da compra" error={touched ? errs.lastPurchaseDate : null} className="sm:col-span-3">
          <Input type="date" value={f.lastPurchaseDate} max={todayISO()} onChange={(e) => set('lastPurchaseDate', e.target.value)} />
        </Field>
        <Field label="Observações" className="sm:col-span-6">
          <Textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} maxLength={500} placeholder="Marca, lote, condições…" />
        </Field>
        {initial && (
          <p className="text-[12px] text-muted sm:col-span-6">
            Alterar preço, quantidade ou data registra uma nova entrada no histórico de preços.
          </p>
        )}
      </form>
    </Modal>
  );
}

function HistoryModal({ ingredient, onClose }: { ingredient: Ingredient; onClose: () => void }) {
  const { history } = useStore();
  const rows = history.filter((h) => h.ingredientId === ingredient.id);
  const base = baseUnitOf(ingredient.unit);
  const factor = base === 'un' ? 1 : 1000;
  const bigUnit = base === 'g' ? 'kg' : base === 'ml' ? 'L' : 'un';
  const data = rows.map((h) => ({ date: date(h.purchaseDate), value: h.costPerBase * factor }));
  const first = rows[0]?.costPerBase;
  const last = rows[rows.length - 1]?.costPerBase;

  return (
    <Modal open onClose={onClose} title={`Histórico de preços · ${ingredient.name}`} description={`Custo por ${bigUnit} em cada compra registrada.`} size="lg">
      {rows.length < 2 ? (
        <Notice>Só há um preço registrado. Ao atualizar o valor da compra, o histórico aparece aqui.</Notice>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-3 gap-3">
            <div><div className="text-[12px] text-muted">Primeiro registro</div><div className="num font-semibold">{money(first * factor)}/{bigUnit}</div></div>
            <div><div className="text-[12px] text-muted">Atual</div><div className="num font-semibold">{money(last * factor)}/{bigUnit}</div></div>
            <div><div className="text-[12px] text-muted">Variação total</div><div className={`num font-semibold ${last > first ? 'text-neg' : 'text-pos'}`}>{first > 0 ? `${last >= first ? '+' : ''}${pct(((last - first) / first) * 100)}` : '—'}</div></div>
          </div>
          <div className="h-56">
            <ResponsiveContainer>
              <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="#e7e5e4" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#78716c' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#78716c' }} tickLine={false} axisLine={false} width={64} tickFormatter={(v) => money(v)} />
                <Tooltip formatter={(v) => [money(Number(v)), `por ${bigUnit}`]} contentStyle={{ borderRadius: 8, border: '1px solid #e7e5e4', fontSize: 12 }} />
                <Line type="monotone" dataKey="value" stroke="#b4385f" strokeWidth={2} dot={{ r: 3, fill: '#b4385f' }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
      <div className="mt-4 overflow-hidden rounded-lg border border-line">
        <TableWrap>
          <thead><tr><Th>Data</Th><Th>Compra</Th><Th align="right">Pago</Th><Th align="right">Custo/{base}</Th><Th align="right">Custo/{bigUnit}</Th></tr></thead>
          <tbody>
            {[...rows].reverse().map((h) => (
              <tr key={h.id}>
                <Td>{date(h.purchaseDate)}</Td>
                <Td className="num text-ink-2">{h.packs !== 1 && `${number(h.packs)} × `}{number(h.packageSize, 3)} {h.unit}</Td>
                <Td align="right">{money(h.totalPrice)}</Td>
                <Td align="right">{moneyPrecise(h.costPerBase)}</Td>
                <Td align="right">{money(h.costPerBase * factor)}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </div>
    </Modal>
  );
}
