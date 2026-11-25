import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useStore } from '../lib/store.tsx';
import { compatibleUnits, costPerBase, toBase } from '../../shared/calc.ts';
import { INGREDIENT_CATEGORIES, type Ingredient, type Unit } from '../../shared/types.ts';
import { money, parseNum } from '../lib/format.ts';
import { Button, IconButton, NumInput, Select } from './ui.tsx';
import { IngredientForm } from '../pages/Ingredients.tsx';

export interface DraftLine {
  key: string;
  ingredientId: number | '';
  quantity: string;
  unit: Unit;
}

export const newLine = (): DraftLine => ({ key: Math.random().toString(36).slice(2), ingredientId: '', quantity: '', unit: 'g' });

export function lineDraftCost(l: DraftLine, map: Map<number, Ingredient>): number | null {
  if (l.ingredientId === '') return null;
  const ing = map.get(l.ingredientId);
  const q = parseNum(l.quantity);
  if (!ing || !(q > 0)) return null;
  if (!compatibleUnits(ing.unit).includes(l.unit)) return null;
  return toBase(q, l.unit) * costPerBase(ing);
}

export function lineError(l: DraftLine): string | null {
  if (l.ingredientId === '') return 'Selecione o ingrediente.';
  if (!(parseNum(l.quantity) > 0)) return 'Informe a quantidade.';
  return null;
}

export function IngredientSelect({ value, onChange, filter }: { value: number | ''; onChange: (id: number | '') => void; filter?: (i: Ingredient) => boolean }) {
  const { ingredients } = useStore();
  const list = filter ? ingredients.filter(filter) : ingredients;
  const groups = INGREDIENT_CATEGORIES.map((c) => [c, list.filter((i) => i.category === c)] as const).filter(([, l]) => l.length);
  const others = list.filter((i) => !(INGREDIENT_CATEGORIES as readonly string[]).includes(i.category));
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : '')}>
      <option value="">Selecione…</option>
      {groups.map(([c, l]) => (
        <optgroup key={c} label={c}>
          {l.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </optgroup>
      ))}
      {others.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
    </Select>
  );
}

export function LineEditor({
  lines,
  onChange,
  showErrors,
  addLabel = 'Adicionar ingrediente',
  emptyText = 'Nenhum item ainda.',
}: {
  lines: DraftLine[];
  onChange: (l: DraftLine[]) => void;
  showErrors?: boolean;
  addLabel?: string;
  emptyText?: string;
}) {
  const { ctx } = useStore();
  const [creatingFor, setCreatingFor] = useState<string | null>(null);

  const update = (key: string, patch: Partial<DraftLine>) =>
    onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const pick = (key: string, id: number | '') => {
    if (id === '') return update(key, { ingredientId: '' });
    const ing = ctx.ingredients.get(id);
    const cur = lines.find((l) => l.key === key)!;
    const units = ing ? compatibleUnits(ing.unit) : ['g' as Unit];
    // mantém a unidade se compatível; senão usa a menor (g, ml, un)
    const unit = units.includes(cur.unit) ? cur.unit : units.includes('g') ? 'g' : units.includes('ml') ? 'ml' : 'un';
    update(key, { ingredientId: id, unit });
  };

  return (
    <div>
      {lines.length === 0 && <div className="rounded-lg border border-dashed border-line px-3 py-5 text-center text-[13px] text-muted">{emptyText}</div>}
      <div className="space-y-2">
        {lines.map((l) => {
          const ing = l.ingredientId === '' ? undefined : ctx.ingredients.get(l.ingredientId);
          const units = ing ? compatibleUnits(ing.unit) : (['g', 'kg', 'ml', 'l', 'un'] as Unit[]);
          const cost = lineDraftCost(l, ctx.ingredients);
          const err = showErrors ? lineError(l) : null;
          return (
            <div key={l.key}>
              <div className="grid grid-cols-[1fr_auto] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_96px_80px_92px_auto]">
                <div className="col-span-2 sm:col-span-1">
                  <IngredientSelect value={l.ingredientId} onChange={(id) => (id === '' ? pick(l.key, '') : pick(l.key, id))} />
                </div>
                <div className="col-span-2 grid grid-cols-[1fr_80px_92px_auto] gap-2 sm:contents">
                  <NumInput value={l.quantity} onChange={(v) => update(l.key, { quantity: v })} placeholder="Qtd." invalid={showErrors && !(parseNum(l.quantity) > 0)} aria-label="Quantidade" />
                  <Select value={l.unit} onChange={(e) => update(l.key, { unit: e.target.value as Unit })} aria-label="Unidade">
                    {units.map((u) => <option key={u} value={u}>{u}</option>)}
                  </Select>
                  <div className="num flex h-8.5 items-center justify-end text-[13px] font-medium text-ink">{cost === null ? <span className="text-faint">—</span> : money(cost)}</div>
                  <IconButton label="Remover" className="hover:text-neg" onClick={() => onChange(lines.filter((x) => x.key !== l.key))}>
                    <Trash2 className="size-4" />
                  </IconButton>
                </div>
              </div>
              {err && <div className="mt-1 text-[12px] text-neg">{err}</div>}
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => onChange([...lines, newLine()])}>{addLabel}</Button>
        <Button size="sm" variant="ghost" onClick={() => setCreatingFor('new')}>Cadastrar ingrediente novo</Button>
      </div>
      {creatingFor && (
        <IngredientForm
          initial={null}
          onClose={() => setCreatingFor(null)}
          onSaved={(ing) => {
            const units = compatibleUnits(ing.unit);
            const unit = units.includes('g') ? 'g' : units.includes('ml') ? 'ml' : 'un';
            const empty = lines.find((l) => l.ingredientId === '');
            if (empty) onChange(lines.map((l) => (l.key === empty.key ? { ...l, ingredientId: ing.id, unit } : l)));
            else onChange([...lines, { ...newLine(), ingredientId: ing.id, unit }]);
          }}
        />
      )}
    </div>
  );
}

export const toDraft = (items: { ingredientId: number; quantity: number; unit: Unit }[]): DraftLine[] =>
  items.map((i) => ({ key: Math.random().toString(36).slice(2), ingredientId: i.ingredientId, quantity: String(i.quantity).replace('.', ','), unit: i.unit }));

export const fromDraft = (lines: DraftLine[]) =>
  lines.map((l) => ({ ingredientId: Number(l.ingredientId), quantity: parseNum(l.quantity), unit: l.unit }));
