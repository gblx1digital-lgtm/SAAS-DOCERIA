# Doceria · Gestão financeira e precificação

Sistema para confeitarias cadastrarem ingredientes, receitas e produtos, descobrirem
quanto custa produzir cada doce e quanto cobrar, e acompanharem vendas e despesas.

## Módulos

| Módulo | O que faz |
| --- | --- |
| **Ingredientes** | Preço pago, quantidade, unidade (g, kg, ml, L, un), fornecedor, data. Calcula o custo por g/ml/un e guarda o histórico de preços. |
| **Receitas** | Ingredientes + quantidades. Custo total, por unidade, por porção e por kg, recalculados ao vivo. |
| **Produtos** | Vários tamanhos por produto, combinando receitas (por unidade, lote ou grama), embalagens e itens avulsos. |
| **Precificação** | Custo completo (ingredientes, embalagens, desperdício, mão de obra, energia/gás/água, despesas fixas), taxas e impostos. Preço mínimo, recomendado e com margem maior; lucro por unidade; simulador de margem, preço e meta de lucro. |
| **Mercado** | Preços de concorrentes registrados por você, com fonte e data. Mostra faixa, mediana e um preço competitivo. Com menos de 3 preços, informa que a comparação não está disponível — nada é inventado. |
| **Financeiro** | Vendas (com custo do produto congelado no momento da venda), compras de ingredientes (podem atualizar o preço do ingrediente), despesas fixas/variáveis e outras entradas/saídas. Visão por dia, semana ou mês. |
| **Painel** | Faturamento, custos, despesas, lucro/prejuízo, evolução do caixa, mais vendidos, mais lucrativos, ingredientes mais usados e alertas de aumento de preço. |

## Como os preços são calculados

```
custo/un  = ingredientes + embalagens + desperdício% × ingredientes
          + (minutos de trabalho / 60) × (pró-labore + contas + despesas fixas) / horas por mês
preço     = custo / (1 − taxa% − imposto% − margem%)
lucro/un  = preço × (1 − taxa% − imposto%) − custo
```

A margem é o lucro líquido sobre o preço de venda, além do seu pró-labore (que já está no custo).
Os minutos vêm do tempo de preparo das receitas (proporcional à fração usada) mais o tempo extra do produto.

## Rodando

Requer **Node.js 22.13+** (usa o SQLite embutido do Node — sem dependências nativas).

```bash
npm install
npm run build
npm start          # http://localhost:3001
```

Desenvolvimento (API + interface com recarregamento automático):

```bash
npm run dev        # interface em http://localhost:5173
```

Testes dos cálculos e da API:

```bash
npm test
```

### Dados

Ficam em `data/doceria.db` (SQLite). Para mudar o local: `DB_PATH=/caminho/doceria.db npm start`.
Faça backup copiando esse arquivo ou pelo botão **Backup (JSON)** em *Custos e configurações*.

### Publicar na internet

Qualquer hospedagem Node com disco persistente (Railway, Render com disco, Fly.io com volume, VPS).
Configure `PORT`, `DB_PATH` apontando para o volume persistente, e rode `npm run build && npm start`.
O sistema não tem login: se for publicar, coloque-o atrás de uma proteção de acesso (ex.: senha no proxy/hospedagem).

## Arquitetura

```
shared/   tipos e motor de cálculo (usado pelo servidor e pela interface)
server/   Express + SQLite (node:sqlite), validação com Zod, painel agregado
src/      React + Vite + Tailwind + Recharts
tests/    Vitest (cálculos e API)
```
