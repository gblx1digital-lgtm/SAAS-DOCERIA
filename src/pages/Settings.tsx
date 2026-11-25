import { useMemo, useState } from 'react';
import { Download, Plus, Trash2 } from 'lucide-react';
import { useStore } from '../lib/store.tsx';
import { api } from '../lib/api.ts';
import { hourlyRates, priceForMargin } from '../../shared/calc.ts';
import type { Settings } from '../../shared/types.ts';
import { money, parseNum, pct, toField } from '../lib/format.ts';
import { Button, Card, Field, IconButton, Input, Notice, NumInput, PageHeader, Select, useFeedback } from '../components/ui.tsx';

type NumKeys = { [K in keyof Settings]: Settings[K] extends number ? K : never }[keyof Settings];
const NUM_KEYS: NumKeys[] = [
  'laborMonthly', 'monthlyHours', 'energyMonthly', 'gasMonthly', 'waterMonthly', 'wastePct', 'avgFeePct', 'feeDebitPct',
  'feeCreditPct', 'feePixPct', 'taxPct', 'targetMarginPct', 'premiumMarginPct', 'roundTo', 'priceAlertPct',
];

export default function SettingsPage() {
  const { settings, reload } = useStore();
  const { toast } = useFeedback();
  const [f, setF] = useState(() => ({
    businessName: settings.businessName,
    city: settings.city,
    ...(Object.fromEntries(NUM_KEYS.map((k) => [k, toField(settings[k])])) as Record<NumKeys, string>),
    fixedCosts: settings.fixedCosts.map((c) => ({ key: Math.random(), name: c.name, monthly: toField(c.monthly) })),
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));

  const parsed: Settings = useMemo(() => {
    const nums = Object.fromEntries(NUM_KEYS.map((k) => [k, f[k].trim() === '' ? 0 : parseNum(f[k])])) as Record<NumKeys, number>;
    return {
      businessName: f.businessName.trim(),
      city: f.city.trim(),
      ...nums,
      roundTo: Number(f.roundTo.replace(',', '.')) || 0,
      fixedCosts: f.fixedCosts.map((c) => ({ name: c.name.trim(), monthly: parseNum(c.monthly) })),
    };
  }, [f]);

  const invalid = NUM_KEYS.filter((k) => !Number.isFinite(parsed[k]) || parsed[k] < 0);
  const fixedInvalid = parsed.fixedCosts.some((c) => !c.name || !(c.monthly >= 0));
  const rates = hourlyRates(parsed);
  const deductions = parsed.avgFeePct + parsed.taxPct;
  const marginErr = deductions + parsed.targetMarginPct >= 100 ? 'Taxas + impostos + margem devem somar menos de 100%.' : null;
  const premiumErr = deductions + parsed.premiumMarginPct >= 100 ? 'Taxas + impostos + margem premium devem somar menos de 100%.' : null;
  const hoursErr = !(parsed.monthlyHours > 0) ? 'Informe as horas de produção por mês.' : parsed.monthlyHours > 744 ? 'Máximo 744 horas.' : null;
  const err = (k: NumKeys) => (invalid.includes(k) ? 'Valor inválido.' : null);
  const example = priceForMargin(10, deductions, parsed.targetMarginPct);

  const save = async () => {
    if (invalid.length || fixedInvalid || marginErr || premiumErr || hoursErr) {
      setError('Corrija os campos destacados.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.put('/settings', parsed);
      await reload('settings');
      toast('Configurações salvas. Todos os preços foram recalculados.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Custos e configurações"
        description="Esses valores entram no custo de cada produto, proporcional ao tempo de produção. Informe apenas a parte das contas usada na produção."
        actions={
          <>
            <a href="/api/export" download><Button icon={<Download className="size-4" />}>Backup (JSON)</Button></a>
            <Button variant="primary" loading={saving} onClick={save}>Salvar configurações</Button>
          </>
        }
      />
      {error && <Notice tone="neg" className="mb-4">{error}</Notice>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <Card title="Confeitaria">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nome"><Input value={f.businessName} onChange={(e) => set('businessName', e.target.value)} maxLength={80} placeholder="Ex.: Doces da Ana" /></Field>
              <Field label="Cidade / região" hint="Usada como padrão na análise de mercado"><Input value={f.city} onChange={(e) => set('city', e.target.value)} maxLength={80} /></Field>
            </div>
          </Card>

          <Card title="Mão de obra e tempo" subtitle="Quanto você quer receber pelo seu trabalho e quantas horas produz por mês.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Pró-labore / salário mensal" error={err('laborMonthly')} hint="Inclua ajudantes, se houver"><NumInput value={f.laborMonthly} onChange={(v) => set('laborMonthly', v)} prefix="R$" /></Field>
              <Field label="Horas de produção por mês" error={err('monthlyHours') ?? hoursErr} hint="Ex.: 8 h × 22 dias = 176 h"><NumInput value={f.monthlyHours} onChange={(v) => set('monthlyHours', v)} suffix="h" /></Field>
            </div>
          </Card>

          <Card title="Energia, gás e água" subtitle="Valor mensal atribuído à produção (não a conta inteira da casa).">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Energia elétrica" error={err('energyMonthly')}><NumInput value={f.energyMonthly} onChange={(v) => set('energyMonthly', v)} prefix="R$" /></Field>
              <Field label="Gás" error={err('gasMonthly')}><NumInput value={f.gasMonthly} onChange={(v) => set('gasMonthly', v)} prefix="R$" /></Field>
              <Field label="Água" error={err('waterMonthly')}><NumInput value={f.waterMonthly} onChange={(v) => set('waterMonthly', v)} prefix="R$" /></Field>
            </div>
          </Card>

          <Card title="Despesas fixas mensais" subtitle="Aluguel, internet, MEI/contador, aplicativos, manutenção, marketing…">
            <div className="space-y-2">
              {f.fixedCosts.length === 0 && <p className="text-[13px] text-muted">Nenhuma despesa fixa informada.</p>}
              {f.fixedCosts.map((c, i) => (
                <div key={c.key} className="grid grid-cols-[1fr_140px_auto] gap-2">
                  <Input value={c.name} onChange={(e) => setF((s) => ({ ...s, fixedCosts: s.fixedCosts.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) }))} placeholder="Descrição" invalid={!c.name.trim()} maxLength={60} />
                  <NumInput value={c.monthly} onChange={(v) => setF((s) => ({ ...s, fixedCosts: s.fixedCosts.map((x, j) => (j === i ? { ...x, monthly: v } : x)) }))} prefix="R$" invalid={!(parseNum(c.monthly) >= 0)} />
                  <IconButton label="Remover" className="mt-0.5 hover:text-neg" onClick={() => setF((s) => ({ ...s, fixedCosts: s.fixedCosts.filter((_, j) => j !== i) }))}><Trash2 className="size-4" /></IconButton>
                </div>
              ))}
            </div>
            <Button size="sm" className="mt-3" icon={<Plus className="size-3.5" />} onClick={() => setF((s) => ({ ...s, fixedCosts: [...s.fixedCosts, { key: Math.random(), name: '', monthly: '' }] }))}>Adicionar despesa</Button>
          </Card>

          <Card title="Taxas, impostos e desperdício">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Taxa no Pix" error={err('feePixPct')}><NumInput value={f.feePixPct} onChange={(v) => set('feePixPct', v)} suffix="%" /></Field>
              <Field label="Taxa no débito" error={err('feeDebitPct')}><NumInput value={f.feeDebitPct} onChange={(v) => set('feeDebitPct', v)} suffix="%" /></Field>
              <Field label="Taxa no crédito" error={err('feeCreditPct')}><NumInput value={f.feeCreditPct} onChange={(v) => set('feeCreditPct', v)} suffix="%" /></Field>
              <Field label="Taxa média para precificar" error={err('avgFeePct')} hint="Média ponderada pelo que seus clientes usam (inclua iFood, se vender lá)"><NumInput value={f.avgFeePct} onChange={(v) => set('avgFeePct', v)} suffix="%" /></Field>
              <Field label="Impostos sobre a venda" error={err('taxPct')} hint="Ex.: alíquota do Simples. MEI: deixe 0 e lance o DAS como despesa fixa."><NumInput value={f.taxPct} onChange={(v) => set('taxPct', v)} suffix="%" /></Field>
              <Field label="Desperdício" error={err('wastePct')} hint="Sobre ingredientes (não embalagens)"><NumInput value={f.wastePct} onChange={(v) => set('wastePct', v)} suffix="%" /></Field>
            </div>
          </Card>

          <Card title="Margem de lucro e preços">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Margem de lucro desejada" error={err('targetMarginPct') ?? marginErr} hint="Lucro líquido sobre o preço de venda"><NumInput value={f.targetMarginPct} onChange={(v) => set('targetMarginPct', v)} suffix="%" /></Field>
              <Field label="Margem do preço “maior”" error={err('premiumMarginPct') ?? premiumErr} hint="Para datas especiais, encomendas, produtos premium"><NumInput value={f.premiumMarginPct} onChange={(v) => set('premiumMarginPct', v)} suffix="%" /></Field>
              <Field label="Arredondar preços sugeridos para cima">
                <Select value={String(parsed.roundTo)} onChange={(e) => set('roundTo', e.target.value)}>
                  <option value="0">Sem arredondamento (centavos)</option>
                  <option value="0.05">R$ 0,05</option>
                  <option value="0.1">R$ 0,10</option>
                  <option value="0.5">R$ 0,50</option>
                  <option value="1">R$ 1,00</option>
                </Select>
              </Field>
              <Field label="Alertar aumento de ingrediente acima de" error={err('priceAlertPct')}><NumInput value={f.priceAlertPct} onChange={(v) => set('priceAlertPct', v)} suffix="%" /></Field>
            </div>
          </Card>
        </div>

        <aside className="space-y-3 lg:sticky lg:top-6 lg:self-start">
          <Card title="Como isso vira custo">
            <dl className="space-y-2 text-[13px]">
              <Row label="Mão de obra" value={`${money(rates.laborPerHour)}/h`} />
              <Row label="Energia, gás e água" value={`${money(rates.utilitiesPerHour)}/h`} />
              <Row label="Despesas fixas" value={`${money(rates.fixedPerHour)}/h`} />
              <div className="flex justify-between border-t border-line pt-2 font-semibold"><dt>Custo da hora</dt><dd className="num">{money(rates.laborPerHour + rates.utilitiesPerHour + rates.fixedPerHour)}</dd></div>
            </dl>
            <p className="mt-3 text-[12px] text-muted">
              Um produto que leva 30 min recebe metade desse valor. O tempo vem do preparo das receitas e do tempo extra do produto.
            </p>
          </Card>
          <Card title="Exemplo">
            <p className="text-[12.5px] text-ink-2">
              Produto com custo de <b>R$ 10,00</b>, {pct(deductions)} de taxas e impostos e margem de {pct(parsed.targetMarginPct, 0)}:
            </p>
            <div className="num mt-2 text-[20px] font-semibold">{example === null ? '—' : money(example)}</div>
            <p className="mt-2 text-[11.5px] text-muted">Preço = custo ÷ (1 − taxas − impostos − margem). Assim a margem é o lucro real que sobra do preço.</p>
          </Card>
        </aside>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-3"><dt className="text-muted">{label}</dt><dd className="num">{value}</dd></div>;
}
