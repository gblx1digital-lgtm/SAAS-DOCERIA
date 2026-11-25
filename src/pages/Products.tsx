import { useMemo, useState } from 'react';
import { Cake, Copy, Pencil, Plus, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../lib/store.tsx';
import { api } from '../lib/api.ts';
import { pricing, safeVariantCost } from '../../shared/calc.ts';
import { PRODUCT_CATEGORIES, PACKAGING_CATEGORY, type ComponentMode, type Product, type ProductVariant } from '../../shared/types.ts';
import { money, parseNum, toField } from '../lib/format.ts';
import { fromDraft, LineEditor, lineError, toDraft, type DraftLine } from '../components/LineEditor.tsx';
import { CostBars, CurrentPriceBadge, PriceTiers } from '../components/PricingPanel.tsx';
import {
  Badge, Button, Card, cx, Empty, Field, IconButton, Input, Modal, Notice, NumInput, PageHeader, SearchInput, Select, Textarea, useFeedback,
} from '../components/ui.tsx';

export default function Products() {
  const { products, recipes, ingredients, ctx, reload } = useStore();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const [copyFrom, setCopyFrom] = useState<Product | null>(null);
  const { toast, confirm } = useFeedback();
  const nav = useNavigate();

  const list = products.filter((p) => (!cat || p.category === cat) && (!q || p.name.toLowerCase().includes(q.toLowerCase())));

  const remove = async (p: Product) => {
    if (!(await confirm({
      title: 'Excluir produto',
      message: <>Excluir <b>{p.name}</b>? Vendas já registradas continuam no financeiro; preços de mercado deste produto serão removidos.</>,
      confirmLabel: 'Excluir', danger: true,
    }))) return;
    try {
      await api.del(`/products/${p.id}`);
      await reload('products', 'market');
      toast('Produto excluído.');
    } catch (e) {
      toast((e as Error).message, 'neg');
    }
  };

  return (
    <>
      <PageHeader
        title="Produtos"
        description="O que você vende. Cada produto pode ter vários tamanhos, combinando receitas, ingredientes avulsos e embalagens."
        actions={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')} disabled={!recipes.length && !ingredients.length}>Novo produto</Button>}
      />
      {!recipes.length && <Notice className="mb-4">Dica: cadastre as receitas antes; o produto usa as receitas para calcular o custo.</Notice>}

      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <SearchInput value={q} onChange={setQ} placeholder="Buscar produto" />
        <Select value={cat} onChange={(e) => setCat(e.target.value)} className="sm:w-48">
          <option value="">Todas as categorias</option>
          {PRODUCT_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </Select>
      </div>

      {products.length === 0 ? (
        <Card>
          <Empty
            icon={<Cake className="size-5" />}
            title="Nenhum produto cadastrado"
            description="Ex.: Brigadeiro gourmet (unidade, caixa com 4, caixa com 12), Bolo de pote, Bolo de aniversário 1,5 kg…"
            action={(recipes.length > 0 || ingredients.length > 0) && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>Criar produto</Button>}
          />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {list.map((p) => (
            <Card key={p.id} padded={false} className={cx(!p.active && 'opacity-70')}>
              <div className="flex items-start justify-between gap-3 px-4 pt-3.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-[14px] font-semibold">{p.name}</h3>
                    {!p.active && <Badge>Inativo</Badge>}
                  </div>
                  <div className="text-[12px] text-muted">{p.category}</div>
                </div>
                <div className="flex shrink-0 gap-0.5">
                  <IconButton label="Duplicar" onClick={() => setCopyFrom(p)}><Copy className="size-4" /></IconButton>
                  <IconButton label="Editar" onClick={() => setEditing(p)}><Pencil className="size-4" /></IconButton>
                  <IconButton label="Excluir" className="hover:text-neg" onClick={() => remove(p)}><Trash2 className="size-4" /></IconButton>
                </div>
              </div>
              <div className="mt-2 divide-y divide-line border-t border-line">
                {p.variants.map((v) => {
                  const { cost, error } = safeVariantCost(v, ctx);
                  const pr = cost ? pricing(cost.breakdown.total, ctx.settings, { targetMargin: v.targetMargin, salePrice: v.salePrice }) : null;
                  return (
                    <button key={v.id} className="grid w-full grid-cols-[1fr_auto] items-center gap-3 px-4 py-2.5 text-left hover:bg-subtle/50" onClick={() => nav(`/precificacao?v=${v.id}`)}>
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-medium">{v.name}</div>
                        <div className="num text-[12px] text-muted">
                          {error ? <span className="text-neg">{error}</span> : <>Custo {money(cost!.breakdown.total)} · Sugerido {money(pr!.recommended)}</>}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="num text-[13.5px] font-semibold">{v.salePrice ? money(v.salePrice) : <span className="text-faint">—</span>}</div>
                        {pr && <CurrentPriceBadge p={pr} />}
                      </div>
                    </button>
                  );
                })}
              </div>
            </Card>
          ))}
          {list.length === 0 && <Card className="md:col-span-2"><Empty title="Nada encontrado" /></Card>}
        </div>
      )}

      {editing && <ProductForm initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {copyFrom && <ProductForm initial={null} template={copyFrom} onClose={() => setCopyFrom(null)} />}
    </>
  );
}

// ───────── Editor ─────────

interface DraftComponent { key: string; recipeId: number | ''; mode: ComponentMode; quantity: string }
interface DraftVariant {
  key: string;
  id?: number;
  name: string;
  salePrice: string;
  targetMargin: string;
  extraMinutes: string;
  components: DraftComponent[];
  items: DraftLine[];
}

const rid = () => Math.random().toString(36).slice(2);
const emptyVariant = (name = 'Unidade'): DraftVariant => ({
  key: rid(), name, salePrice: '', targetMargin: '', extraMinutes: '', components: [{ key: rid(), recipeId: '', mode: 'unit', quantity: '1' }], items: [],
});

function toDraftVariant(v: ProductVariant, keepId: boolean): DraftVariant {
  return {
    key: rid(),
    id: keepId ? v.id : undefined,
    name: v.name,
    salePrice: toField(v.salePrice),
    targetMargin: toField(v.targetMargin),
    extraMinutes: v.extraMinutes ? toField(v.extraMinutes) : '',
    components: v.components.map((c) => ({ key: rid(), recipeId: c.recipeId, mode: c.mode, quantity: toField(c.quantity) })),
    items: toDraft(v.items),
  };
}

function parseVariant(v: DraftVariant): ProductVariant {
  return {
    id: v.id,
    name: v.name.trim(),
    salePrice: v.salePrice.trim() ? parseNum(v.salePrice) : null,
    targetMargin: v.targetMargin.trim() ? parseNum(v.targetMargin) : null,
    extraMinutes: v.extraMinutes.trim() ? parseNum(v.extraMinutes) : 0,
    components: v.components.map((c) => ({ recipeId: Number(c.recipeId), mode: c.mode, quantity: parseNum(c.quantity) })),
    items: fromDraft(v.items),
  };
}

function variantErrors(v: DraftVariant, recipes: Map<number, { totalWeightG: number | null }>): string | null {
  if (!v.name.trim()) return 'Dê um nome ao tamanho/versão.';
  if (v.components.length + v.items.length === 0) return 'Adicione ao menos uma receita ou item.';
  for (const c of v.components) {
    if (c.recipeId === '') return 'Selecione a receita.';
    if (!(parseNum(c.quantity) > 0)) return 'Informe a quantidade da receita.';
    if (c.mode === 'gram' && !recipes.get(c.recipeId)?.totalWeightG) return 'Para usar em gramas, informe o peso final na receita.';
  }
  if (v.items.some(lineError)) return 'Complete os itens avulsos.';
  if (v.salePrice.trim() && !(parseNum(v.salePrice) >= 0)) return 'Preço de venda inválido.';
  if (v.targetMargin.trim()) {
    const m = parseNum(v.targetMargin);
    if (!(m >= 0 && m <= 95)) return 'Margem deve estar entre 0 e 95%.';
  }
  if (v.extraMinutes.trim() && !(parseNum(v.extraMinutes) >= 0)) return 'Tempo extra inválido.';
  return null;
}

const MODE_LABEL: Record<ComponentMode, string> = { unit: 'unidade(s) do rendimento', batch: 'receita(s) inteira(s)', gram: 'gramas' };

function ProductForm({ initial, template, onClose }: { initial: Product | null; template?: Product; onClose: () => void }) {
  const { recipes, ctx, reload } = useStore();
  const { toast } = useFeedback();
  const src = initial ?? template;
  const [f, setF] = useState({
    name: initial ? initial.name : template ? `${template.name} (cópia)` : '',
    category: src?.category ?? PRODUCT_CATEGORIES[0],
    description: src?.description ?? '',
    active: src?.active ?? true,
  });
  const [variants, setVariants] = useState<DraftVariant[]>(src ? src.variants.map((v) => toDraftVariant(v, !!initial)) : [emptyVariant()]);
  const [active, setActive] = useState(0);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const v = variants[Math.min(active, variants.length - 1)];
  const upd = (patch: Partial<DraftVariant>) => setVariants((vs) => vs.map((x) => (x.key === v.key ? { ...x, ...patch } : x)));

  const errs = variants.map((x) => variantErrors(x, ctx.recipes));
  const nameErr = !f.name.trim() ? 'Informe o nome.' : null;
  const valid = !nameErr && errs.every((e) => !e);

  const live = useMemo(() => {
    if (variantErrors(v, ctx.recipes)) return null;
    const pv = parseVariant(v);
    const { cost, error } = safeVariantCost(pv, ctx);
    if (!cost) return { error };
    return { cost, pricing: pricing(cost.breakdown.total, ctx.settings, { targetMargin: pv.targetMargin, salePrice: pv.salePrice }), error: null };
  }, [v, ctx]);

  const submit = async () => {
    if (saving) return;
    setTouched(true);
    if (!valid) {
      const bad = errs.findIndex(Boolean);
      if (bad >= 0) setActive(bad);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body = { ...f, name: f.name.trim(), variants: variants.map(parseVariant) };
      if (initial) await api.put(`/products/${initial.id}`, body);
      else await api.post('/products', body);
      await reload('products');
      toast(initial ? 'Produto atualizado.' : 'Produto criado.');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const updComp = (key: string, patch: Partial<DraftComponent>) => upd({ components: v.components.map((c) => (c.key === key ? { ...c, ...patch } : c)) });

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={initial ? `Editar ${initial.name}` : 'Novo produto'}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" loading={saving} onClick={submit}>{initial ? 'Salvar alterações' : 'Criar produto'}</Button>
        </>
      }
    >
      {error && <Notice tone="neg" className="mb-4">{error}</Notice>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-6">
        <Field label="Nome do produto" error={touched ? nameErr : null} className="sm:col-span-3">
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Ex.: Brigadeiro gourmet" maxLength={120} />
        </Field>
        <Field label="Categoria" className="sm:col-span-2">
          <Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
            {PRODUCT_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </Select>
        </Field>
        <Field label="Situação">
          <Select value={f.active ? '1' : '0'} onChange={(e) => setF({ ...f, active: e.target.value === '1' })}>
            <option value="1">Ativo</option>
            <option value="0">Inativo</option>
          </Select>
        </Field>
        <Field label="Descrição" hint="Opcional" className="sm:col-span-6">
          <Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={1000} className="min-h-[52px]" rows={2} />
        </Field>
      </div>

      <div className="mt-6 flex items-center gap-1 overflow-x-auto border-b border-line">
        {variants.map((x, i) => (
          <button
            key={x.key}
            onClick={() => setActive(i)}
            className={cx(
              '-mb-px flex h-9 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-[13px] font-medium',
              x.key === v.key ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink',
            )}
          >
            {x.name || 'Sem nome'}
            {touched && errs[i] && <span className="size-1.5 rounded-full bg-neg" />}
          </button>
        ))}
        <button
          className="ml-1 flex h-9 items-center gap-1 px-2 text-[12.5px] font-medium text-muted hover:text-ink"
          onClick={() => {
            const copy = { ...toDraftVariant(parseVariant(v), false), key: rid(), name: `Tamanho ${variants.length + 1}`, components: v.components.map((c) => ({ ...c, key: rid() })), items: v.items.map((l) => ({ ...l, key: rid() })) };
            setVariants([...variants, copy]);
            setActive(variants.length);
          }}
        >
          <Plus className="size-3.5" /> Tamanho
        </button>
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-5">
          {touched && errs[variants.indexOf(v)] && <Notice tone="neg">{errs[variants.indexOf(v)]}</Notice>}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Nome do tamanho" className="col-span-2">
              <Input value={v.name} onChange={(e) => upd({ name: e.target.value })} placeholder="Unidade, Caixa c/ 4, 1,5 kg…" maxLength={60} />
            </Field>
            <Field label="Meu preço atual" hint="Opcional">
              <NumInput value={v.salePrice} onChange={(x) => upd({ salePrice: x })} prefix="R$" placeholder="—" />
            </Field>
            <Field label="Margem própria" hint={`Padrão ${ctx.settings.targetMarginPct}%`}>
              <NumInput value={v.targetMargin} onChange={(x) => upd({ targetMargin: x })} suffix="%" placeholder="—" />
            </Field>
          </div>

          <div>
            <h4 className="mb-1 text-[13px] font-semibold">Receitas</h4>
            <p className="mb-2 text-[12px] text-muted">Quanto de cada receita entra em 1 unidade deste tamanho. O tempo de preparo é proporcional.</p>
            <div className="space-y-2">
              {v.components.map((c) => {
                const r = c.recipeId === '' ? undefined : ctx.recipes.get(c.recipeId);
                return (
                  <div key={c.key} className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[minmax(0,1fr)_88px_190px_auto]">
                    <div className="col-span-2 sm:col-span-1">
                      <Select value={c.recipeId} onChange={(e) => updComp(c.key, { recipeId: e.target.value ? Number(e.target.value) : '' })}>
                        <option value="">Selecione a receita…</option>
                        {recipes.map((r) => <option key={r.id} value={r.id}>{r.name} (rende {r.yieldQty} {r.yieldLabel})</option>)}
                      </Select>
                    </div>
                    <div className="col-span-2 grid grid-cols-[88px_1fr_auto] gap-2 sm:contents">
                      <NumInput value={c.quantity} onChange={(x) => updComp(c.key, { quantity: x })} aria-label="Quantidade" />
                      <Select value={c.mode} onChange={(e) => updComp(c.key, { mode: e.target.value as ComponentMode })} aria-label="Medida">
                        <option value="unit">{r ? r.yieldLabel : MODE_LABEL.unit}</option>
                        <option value="batch">{MODE_LABEL.batch}</option>
                        <option value="gram" disabled={!!r && !r.totalWeightG}>gramas{r && !r.totalWeightG ? ' (informe o peso)' : ''}</option>
                      </Select>
                      <IconButton label="Remover" className="mt-0.5 hover:text-neg" onClick={() => upd({ components: v.components.filter((x) => x.key !== c.key) })}>
                        <Trash2 className="size-4" />
                      </IconButton>
                    </div>
                  </div>
                );
              })}
            </div>
            <Button size="sm" className="mt-2" icon={<Plus className="size-3.5" />} onClick={() => upd({ components: [...v.components, { key: rid(), recipeId: '', mode: 'unit', quantity: '1' }] })} disabled={!recipes.length}>
              Adicionar receita
            </Button>
          </div>

          <div>
            <h4 className="mb-1 text-[13px] font-semibold">Embalagens e itens avulsos</h4>
            <p className="mb-2 text-[12px] text-muted">Caixa, forminha, fita, topper ou ingrediente usado direto na montagem. Itens da categoria “{PACKAGING_CATEGORY}” não sofrem desperdício.</p>
            <LineEditor lines={v.items} onChange={(items) => upd({ items })} showErrors={touched} addLabel="Adicionar item" emptyText="Nenhuma embalagem ou item avulso." />
          </div>

          <Field label="Tempo extra por unidade" hint="Montagem, decoração, embalar. Somado ao tempo das receitas." className="max-w-[220px]">
            <NumInput value={v.extraMinutes} onChange={(x) => upd({ extraMinutes: x })} suffix="min" placeholder="0" />
          </Field>

          {variants.length > 1 && (
            <Button variant="danger" size="sm" icon={<Trash2 className="size-3.5" />} onClick={() => { setVariants(variants.filter((x) => x.key !== v.key)); setActive(0); }}>
              Remover tamanho “{v.name || 'sem nome'}”
            </Button>
          )}
        </div>

        <aside className="space-y-3 lg:sticky lg:top-0 lg:self-start">
          <div className="rounded-xl border border-line bg-subtle/60 p-4">
            <div className="text-[12.5px] font-medium text-muted">Custo de produção por unidade</div>
            <div className="num mt-1 text-[26px] font-semibold tracking-[-0.02em]">{live?.cost ? money(live.cost.breakdown.total) : '—'}</div>
            {live?.error && <div className="mt-2 text-[12.5px] text-neg">{live.error}</div>}
            {!live && <div className="mt-2 text-[12.5px] text-muted">Complete o tamanho para ver o custo.</div>}
            {live?.cost && <div className="mt-4 border-t border-line pt-4"><CostBars b={live.cost.breakdown} /></div>}
          </div>
          {live?.pricing && (
            <>
              <PriceTiers p={live.pricing} compact />
              {live.pricing.current && (
                <div className="rounded-lg border border-line bg-surface p-3 text-[12.5px]">
                  <div className="flex items-center justify-between"><span className="text-muted">Lucro no meu preço</span><span className={cx('num font-semibold', live.pricing.current.profit < 0 ? 'text-neg' : 'text-pos')}>{money(live.pricing.current.profit)}</span></div>
                  <div className="mt-1.5 flex items-center justify-between"><span className="text-muted">Situação</span><CurrentPriceBadge p={live.pricing} /></div>
                </div>
              )}
            </>
          )}
        </aside>
      </div>
    </Modal>
  );
}
