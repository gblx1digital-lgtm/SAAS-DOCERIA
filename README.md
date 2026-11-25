# Doceria · Gestão financeira e precificação

Sistema para confeitarias cadastrarem ingredientes, receitas e produtos, descobrirem
quanto custa produzir cada doce e quanto cobrar, e acompanharem vendas e despesas.

Roda **100% no navegador**: é um site estático (pronto para o Netlify) com um banco de dados
SQLite (WebAssembly) salvo no próprio aparelho. Não precisa de servidor nem de login,
e os dados não saem do aparelho.

## Publicar no Netlify

```bash
npm install
npm run package
```

Isso gera `doceria-netlify-vX.Y.Z.zip` (com a versão no nome; a versão também aparece no menu do sistema). No Netlify, entre na sua conta, vá em **Sites → Add new site →
Deploy manually** e arraste o arquivo (ou a pasta `dist/`). Para atualizar depois, abra o site no
Netlify → **Deploys** e arraste o novo arquivo.

Também funciona conectando este repositório no Netlify (o `netlify.toml` já configura o build).

## Onde ficam os dados

- No navegador de cada aparelho (IndexedDB). Cada alteração é gravada na hora.
- Computador e celular têm dados **separados**. Para levar de um para o outro:
  *Custos e configurações → Fazer backup* num aparelho e *Restaurar backup* no outro.
- O backup é um arquivo `.json` (contém o banco SQLite completo). No celular abre o menu de
  compartilhar (Arquivos, Drive, WhatsApp, e-mail).
- Se o navegador for limpo, os dados somem: faça backups com frequência. O painel lembra
  quando o último backup tem mais de 7 dias.
- O endereço importa: `seusite.netlify.app` e um domínio próprio guardam dados separados.

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

## Desenvolvimento

Requer Node.js 20.19+ ou 22.12+ (os testes, `npm test`, precisam do 22.12+).

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # testes dos cálculos, da API local e do backup
npm run build      # gera dist/
npm run preview    # serve dist/ localmente
```

## Arquitetura

```
shared/   tipos e motor de cálculo
core/     banco (SQLite via sql.js), regras de negócio, validação (Zod) e API local
src/      interface React + Vite + Tailwind + Recharts; db-client.ts salva o banco no IndexedDB
tests/    Vitest (cálculos, API e backup, no mesmo motor SQLite do navegador)
scripts/  package.mjs gera o .zip para o Netlify
```

A interface conversa com `core/api.ts` como se fosse uma API HTTP, mas tudo roda no navegador.
Cada alteração roda numa transação (tudo ou nada) e o banco inteiro é gravado no IndexedDB
antes de a tela confirmar. Abas abertas ao mesmo tempo se sincronizam (BroadcastChannel +
Web Locks), e dados salvos que não puderem ser abertos nunca são sobrescritos automaticamente.
