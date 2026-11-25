import { useMemo, useState } from 'react';
import { BookOpen, Copy, Pencil, Plus, Trash2 } from 'lucide-react';
import { useStore } from '../lib/store.tsx';
import { api } from '../lib/api.ts';
import { CalcError, productsUsingRecipe, recipeCost, type RecipeCost } from '../../shared/calc.ts';
import type { Recipe } from '../../shared/types.ts';
import { minutes, money, number, parseNum, toField } from '../lib/format.ts';
import { fromDraft, LineEditor, lineDraftCost, lineError, newLine, toDraft, type DraftLine } from '../components/LineEditor.tsx';
import {
  Badge, Button, Card, Empty, Field, IconButton, Input, Modal, Notice, NumInput, PageHeader, SearchInput, TableWrap, Td, Textarea, Th, useFeedback,
} from '../components/ui.tsx';

function safeRecipeCost(r: Recipe, map: Parameters<typeof recipeCost>[1]): RecipeCost | null {
  try {
    return recipeCost(r, map);
  } catch (e) {
    if (e instanceof CalcError) return null;
    throw e;
  }
}

export default function Recipes() {
  const { recipes, products, ingredients, ctx, reload } = useStore();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Recipe | 'new' | null>(null);
  const [copyFrom, setCopyFrom] = useState<Recipe | null>(null);
  const { toast, confirm } = useFeedback();

  const list = recipes.filter((r) => !q || `${r.name} ${r.category}`.toLowerCase().includes(q.toLowerCase()));

  const remove = async (r: Recipe) => {
    if (!(await confirm({ title: 'Excluir receita', message: <>Excluir a receita <b>{r.name}</b>?</>, confirmLabel: 'Excluir', danger: true }))) return;
    try {
      await api.del(`/recipes/${r.id}`);
      await reload('recipes');
      toast('Receita excluída.');
    } catch (e) {
      toast((e as Error).message, 'neg');
    }
  };

  return (
    <>
      <PageHeader
        title="Receitas"
        description="Monte as receitas com os ingredientes cadastrados. Custos totais, por unidade e por porção são recalculados sempre que um preço muda."
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')} disabled={!ingredients.length}>
            Nova receita
          </Button>
        }
      />
      {!ingredients.length && (
        <Notice className="mb-4">Cadastre ingredientes antes de montar receitas.</Notice>
      )}
      <Card padded={false}>
        <div className="flex items-center gap-2 border-b border-line p-3">
          <SearchInput value={q} onChange={setQ} placeholder="Buscar receita" />
          <div className="ml-auto text-[12.5px] text-muted">{recipes.length} receita(s)</div>
        </div>
        {recipes.length === 0 ? (
          <Empty
            icon={<BookOpen className="size-5" />}
            title="Nenhuma receita ainda"
            description="Ex.: Brigadeiro — 395 g de leite condensado, 100 g de creme de leite, 50 g de chocolate, 20 g de manteiga."
            action={ingredients.length ? <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>Criar receita</Button> : undefined}
          />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Receita</Th>
                <Th align="right">Rendimento</Th>
                <Th align="right" className="hidden md:table-cell">Preparo</Th>
                <Th align="right">Custo total</Th>
                <Th align="right">Por unidade</Th>
                <Th align="right" className="hidden sm:table-cell">Por porção</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {list.map((r) => {
                const c = safeRecipeCost(r, ctx.ingredients);
                const used = productsUsingRecipe(products, r.id);
                return (
                  <tr key={r.id} className="hover:bg-subtle/50">
                    <Td>
                      <button className="text-left" onClick={() => setEditing(r)}>
                        <div className="font-medium text-ink hover:underline">{r.name}</div>
                        <div className="text-[12px] text-muted">
                          {r.items.length} ingrediente(s){used.length ? ` · usada em ${used.length} produto(s)` : ''}
                        </div>
                      </button>
                    </Td>
                    <Td align="right" className="whitespace-nowrap">{number(r.yieldQty)} {r.yieldLabel}</Td>
                    <Td align="right" className="hidden whitespace-nowrap md:table-cell">{minutes(r.prepMinutes)}</Td>
                    <Td align="right" className="font-medium">{c ? money(c.total) : <Badge tone="neg">Erro</Badge>}</Td>
                    <Td align="right">{c ? money(c.perUnit) : '—'}</Td>
                    <Td align="right" className="hidden sm:table-cell">{c?.perPortion != null ? money(c.perPortion) : <span className="text-faint">—</span>}</Td>
                    <Td className="w-px whitespace-nowrap">
                      <div className="flex justify-end gap-0.5">
                        <IconButton label="Duplicar" onClick={() => setCopyFrom(r)}><Copy className="size-4" /></IconButton>
                        <IconButton label="Editar" onClick={() => setEditing(r)}><Pencil className="size-4" /></IconButton>
                        <IconButton label="Excluir" className="hover:text-neg" onClick={() => remove(r)}><Trash2 className="size-4" /></IconButton>
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
      </Card>
      {editing && <RecipeForm initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {copyFrom && <RecipeForm initial={null} template={copyFrom} onClose={() => setCopyFrom(null)} />}
    </>
  );
}

function RecipeForm({ initial, template, onClose }: { initial: Recipe | null; template?: Recipe; onClose: () => void }) {
  const { ctx, reload, products } = useStore();
  const { toast } = useFeedback();
  const src = initial ?? template;
  const [f, setF] = useState({
    name: initial ? initial.name : template ? `${template.name} (cópia)` : '',
    category: src?.category ?? '',
    yieldQty: toField(src?.yieldQty),
    yieldLabel: src?.yieldLabel ?? 'unidades',
    portions: toField(src?.portions),
    totalWeightG: toField(src?.totalWeightG),
    prepMinutes: toField(src?.prepMinutes ?? 0),
    notes: src?.notes ?? '',
  });
  const [lines, setLines] = useState<DraftLine[]>(src ? toDraft(src.items) : [newLine()]);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: string) => setF((s) => ({ ...s, [k]: v }));

  const yieldQty = parseNum(f.yieldQty);
  const portions = f.portions ? parseNum(f.portions) : null;
  const weight = f.totalWeightG ? parseNum(f.totalWeightG) : null;
  const prep = f.prepMinutes ? parseNum(f.prepMinutes) : 0;

  const errs = {
    name: !f.name.trim() ? 'Informe o nome.' : null,
    yieldQty: !(yieldQty > 0) ? 'Quantas unidades a receita rende?' : null,
    portions: portions !== null && !(portions > 0) ? 'Valor inválido.' : null,
    weight: weight !== null && !(weight > 0) ? 'Valor inválido.' : null,
    prep: !(prep >= 0) ? 'Valor inválido.' : null,
    lines: lines.length === 0 ? 'Adicione pelo menos um ingrediente.' : lines.some(lineError) ? 'Complete os ingredientes.' : null,
  };
  const valid = Object.values(errs).every((e) => !e);

  const total = useMemo(() => lines.reduce((s, l) => s + (lineDraftCost(l, ctx.ingredients) ?? 0), 0), [lines, ctx.ingredients]);
  const linesWeight = useMemo(
    () => lines.reduce((s, l) => {
      const q = parseNum(l.quantity);
      return s + (q > 0 ? (l.unit === 'kg' ? q * 1000 : l.unit === 'g' ? q : 0) : 0);
    }, 0),
    [lines],
  );
  const usedBy = initial ? productsUsingRecipe(products, initial.id) : [];

  const submit = async () => {
    setTouched(true);
    if (!valid) return;
    setSaving(true);
    setError(null);
    try {
      const body = { ...f, yieldQty, portions, totalWeightG: weight, prepMinutes: prep, items: fromDraft(lines) };
      if (initial) await api.put(`/recipes/${initial.id}`, body);
      else await api.post('/recipes', body);
      await reload('recipes');
      toast(initial ? 'Receita atualizada.' : 'Receita criada.');
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
      size="xl"
      title={initial ? `Editar ${initial.name}` : 'Nova receita'}
      description="Os custos são atualizados enquanto você digita."
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" loading={saving} onClick={submit}>{initial ? 'Salvar alterações' : 'Criar receita'}</Button>
        </>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-5">
          {error && <Notice tone="neg">{error}</Notice>}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Nome da receita" error={touched ? errs.name : null} className="sm:col-span-2">
              <Input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Ex.: Brigadeiro tradicional" maxLength={120} />
            </Field>
            <Field label="Categoria" hint="Opcional">
              <Input value={f.category} onChange={(e) => set('category', e.target.value)} placeholder="Massa, recheio…" maxLength={60} />
            </Field>
          </div>

          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <h4 className="text-[13px] font-semibold">Ingredientes</h4>
              {touched && errs.lines && <span className="text-[12px] text-neg">{errs.lines}</span>}
            </div>
            <LineEditor lines={lines} onChange={setLines} showErrors={touched} />
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Field label="Rendimento" error={touched ? errs.yieldQty : null}>
              <NumInput value={f.yieldQty} onChange={(v) => set('yieldQty', v)} placeholder="30" />
            </Field>
            <Field label="Unidade do rendimento">
              <Input value={f.yieldLabel} onChange={(e) => set('yieldLabel', e.target.value)} placeholder="unidades" maxLength={30} />
            </Field>
            <Field label="Porções" hint="Opcional" error={touched ? errs.portions : null}>
              <NumInput value={f.portions} onChange={(v) => set('portions', v)} placeholder="—" />
            </Field>
            <Field label="Tempo de preparo" hint="Lote inteiro" error={touched ? errs.prep : null}>
              <NumInput value={f.prepMinutes} onChange={(v) => set('prepMinutes', v)} suffix="min" />
            </Field>
            <Field
              label="Peso final pronto"
              className="col-span-2"
              error={touched ? errs.weight : null}
              hint={linesWeight > 0 ? `Soma dos ingredientes em gramas: ${number(linesWeight, 0)} g. Necessário para usar a receita por grama em produtos.` : 'Opcional. Permite usar a receita por grama nos produtos.'}
            >
              <NumInput value={f.totalWeightG} onChange={(v) => set('totalWeightG', v)} suffix="g" placeholder="—" />
            </Field>
            <Field label="Modo de preparo / observações" className="col-span-2">
              <Textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} maxLength={2000} />
            </Field>
          </div>
        </div>

        <aside className="lg:sticky lg:top-0 lg:self-start">
          <div className="rounded-xl border border-line bg-subtle/60 p-4">
            <div className="text-[12.5px] font-medium text-muted">Custo total da receita</div>
            <div className="num mt-1 text-[26px] font-semibold tracking-[-0.02em]">{money(total)}</div>
            <dl className="mt-4 space-y-2.5 border-t border-line pt-4 text-[13px]">
              <Row label={`Por ${yieldQty > 0 && f.yieldLabel ? f.yieldLabel.replace(/s$/, '') : 'unidade'}`} value={yieldQty > 0 ? money(total / yieldQty) : '—'} strong />
              <Row label="Por porção" value={portions && portions > 0 ? money(total / portions) : '—'} />
              <Row label="Por kg" value={weight && weight > 0 ? money((total / weight) * 1000) : '—'} />
              <Row label="Quantidade produzida" value={yieldQty > 0 ? `${number(yieldQty)} ${f.yieldLabel}` : '—'} />
            </dl>
            {lines.some((l) => lineDraftCost(l, ctx.ingredients) !== null) && (
              <div className="mt-4 border-t border-line pt-4">
                <div className="mb-2 text-[12px] font-medium text-muted">Peso no custo</div>
                <div className="space-y-1.5">
                  {lines
                    .map((l) => ({ l, c: lineDraftCost(l, ctx.ingredients) ?? 0 }))
                    .filter((x) => x.c > 0)
                    .sort((a, b) => b.c - a.c)
                    .slice(0, 6)
                    .map(({ l, c }) => (
                      <div key={l.key}>
                        <div className="flex justify-between text-[12px]">
                          <span className="truncate text-ink-2">{ctx.ingredients.get(Number(l.ingredientId))?.name}</span>
                          <span className="num text-muted">{total > 0 ? `${number((c / total) * 100, 0)}%` : ''}</span>
                        </div>
                        <div className="mt-0.5 h-1 rounded-full bg-line">
                          <div className="h-1 rounded-full bg-accent" style={{ width: `${total > 0 ? (c / total) * 100 : 0}%` }} />
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
          {usedBy.length > 0 && (
            <p className="mt-3 text-[12px] text-muted">Alterações refletem em: {usedBy.map((p) => p.name).join(', ')}.</p>
          )}
        </aside>
      </div>
    </Modal>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className={`num ${strong ? 'font-semibold text-ink' : 'text-ink-2'}`}>{value}</dd>
    </div>
  );
}
