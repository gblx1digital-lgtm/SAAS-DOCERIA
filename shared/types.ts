// Tipos compartilhados entre servidor e interface.

export type Unit = 'g' | 'kg' | 'ml' | 'l' | 'un';
export type BaseUnit = 'g' | 'ml' | 'un';

export const UNITS: Unit[] = ['g', 'kg', 'ml', 'l', 'un'];

export const INGREDIENT_CATEGORIES = [
  'Laticínios',
  'Chocolates e cacau',
  'Farinhas e grãos',
  'Açúcares e adoçantes',
  'Gorduras',
  'Ovos',
  'Frutas',
  'Recheios e coberturas',
  'Fermentos e aditivos',
  'Decoração',
  'Embalagens',
  'Outros',
] as const;

/** Categoria tratada como embalagem (não sofre % de desperdício). */
export const PACKAGING_CATEGORY = 'Embalagens';

export const PRODUCT_CATEGORIES = [
  'Bolos',
  'Brigadeiros',
  'Brownies',
  'Docinhos',
  'Tortas',
  'Sobremesas',
  'Bolos de pote',
  'Ovos de Páscoa',
  'Outros',
] as const;

export interface Ingredient {
  id: number;
  name: string;
  category: string;
  supplier: string;
  /** Unidade da embalagem comprada. */
  unit: Unit;
  /** Conteúdo de cada embalagem, na unidade acima (ex.: 395 g). */
  packageSize: number;
  /** Quantas embalagens foram compradas. */
  packs: number;
  /** Valor total pago pela compra (R$). */
  totalPrice: number;
  /** Data ISO (AAAA-MM-DD) da última compra. */
  lastPurchaseDate: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface PriceHistoryEntry {
  id: number;
  ingredientId: number;
  totalPrice: number;
  packageSize: number;
  packs: number;
  unit: Unit;
  costPerBase: number;
  purchaseDate: string;
  recordedAt: string;
}

export interface ItemLine {
  id?: number;
  ingredientId: number;
  quantity: number;
  unit: Unit;
}

export interface Recipe {
  id: number;
  name: string;
  category: string;
  /** Rendimento em unidades (ex.: 30 brigadeiros). */
  yieldQty: number;
  /** Rótulo da unidade de rendimento (ex.: "unidades", "fatias"). */
  yieldLabel: string;
  /** Quantidade de porções (opcional). */
  portions: number | null;
  /** Peso final da massa pronta, em gramas (opcional, permite usar a receita por grama). */
  totalWeightG: number | null;
  /** Tempo de preparo do lote inteiro, em minutos. */
  prepMinutes: number;
  notes: string;
  items: ItemLine[];
  createdAt: string;
  updatedAt: string;
}

export type ComponentMode = 'batch' | 'unit' | 'gram';

export interface VariantComponent {
  id?: number;
  recipeId: number;
  mode: ComponentMode;
  quantity: number;
}

export interface ProductVariant {
  id?: number;
  /** Tamanho/versão (ex.: "Unidade", "Caixa c/ 4", "Bolo 1,5 kg"). */
  name: string;
  /** Meu preço de venda atual (R$), opcional. */
  salePrice: number | null;
  /** Margem desejada própria (%), nula = usar a padrão. */
  targetMargin: number | null;
  /** Minutos extras de trabalho por unidade (montagem, decoração). */
  extraMinutes: number;
  components: VariantComponent[];
  /** Ingredientes/embalagens adicionados diretamente ao produto. */
  items: ItemLine[];
}

export interface Product {
  id: number;
  name: string;
  category: string;
  description: string;
  active: boolean;
  variants: (ProductVariant & { id: number })[];
  createdAt: string;
  updatedAt: string;
}

export interface FixedCost {
  name: string;
  monthly: number;
}

export interface Settings {
  businessName: string;
  city: string;
  /** Quanto você quer receber por mês pelo seu trabalho (R$). */
  laborMonthly: number;
  /** Horas de produção por mês. */
  monthlyHours: number;
  /** Parcela mensal das contas destinada à produção (R$). */
  energyMonthly: number;
  gasMonthly: number;
  waterMonthly: number;
  fixedCosts: FixedCost[];
  /** % de desperdício sobre ingredientes. */
  wastePct: number;
  /** Taxa média de pagamento usada na precificação (%). */
  avgFeePct: number;
  feeDebitPct: number;
  feeCreditPct: number;
  feePixPct: number;
  /** Impostos sobre a venda (%), ex.: Simples Nacional. */
  taxPct: number;
  /** Margem de lucro padrão (% sobre o preço de venda). */
  targetMarginPct: number;
  /** Margem do preço "premium" (%). */
  premiumMarginPct: number;
  /** Arredondamento para cima dos preços sugeridos (R$). 0 = sem arredondamento. */
  roundTo: number;
  /** Aumento (%) a partir do qual um ingrediente gera alerta. */
  priceAlertPct: number;
}

export const DEFAULT_SETTINGS: Settings = {
  businessName: '',
  city: '',
  laborMonthly: 0,
  monthlyHours: 160,
  energyMonthly: 0,
  gasMonthly: 0,
  waterMonthly: 0,
  fixedCosts: [],
  wastePct: 5,
  avgFeePct: 0,
  feeDebitPct: 0,
  feeCreditPct: 0,
  feePixPct: 0,
  taxPct: 0,
  targetMarginPct: 30,
  premiumMarginPct: 40,
  roundTo: 0.5,
  priceAlertPct: 5,
};

export interface MarketPrice {
  id: number;
  productId: number;
  variantId: number | null;
  competitor: string;
  region: string;
  price: number;
  /** De onde veio o preço (link, cardápio, visita, iFood...). */
  source: string;
  observedAt: string;
  notes: string;
  createdAt: string;
}

export type TxType = 'entrada' | 'saida';
export type TxCategory =
  | 'venda'
  | 'outra_entrada'
  | 'compra_ingrediente'
  | 'despesa_fixa'
  | 'despesa_variavel'
  | 'outra_saida';

export type PaymentMethod = 'dinheiro' | 'pix' | 'debito' | 'credito' | 'outro';

export const TX_CATEGORY_LABEL: Record<TxCategory, string> = {
  venda: 'Venda',
  outra_entrada: 'Outra entrada',
  compra_ingrediente: 'Compra de ingredientes',
  despesa_fixa: 'Despesa fixa',
  despesa_variavel: 'Despesa variável',
  outra_saida: 'Outra saída',
};

export const TX_CATEGORY_TYPE: Record<TxCategory, TxType> = {
  venda: 'entrada',
  outra_entrada: 'entrada',
  compra_ingrediente: 'saida',
  despesa_fixa: 'saida',
  despesa_variavel: 'saida',
  outra_saida: 'saida',
};

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  dinheiro: 'Dinheiro',
  pix: 'Pix',
  debito: 'Débito',
  credito: 'Crédito',
  outro: 'Outro',
};

export interface Transaction {
  id: number;
  date: string;
  type: TxType;
  category: TxCategory;
  description: string;
  /** Valor bruto (R$). */
  amount: number;
  /** Taxa da maquininha/plataforma descontada (R$). */
  fee: number;
  paymentMethod: PaymentMethod | null;
  productId: number | null;
  variantId: number | null;
  quantity: number | null;
  /** Custo de produção completo por unidade no momento da venda (R$), usado na precificação. */
  unitCost: number | null;
  /** Ingredientes + embalagens + desperdício por unidade no momento da venda (R$). */
  unitMaterialCost: number | null;
  /** Mão de obra por unidade (tempo de produção) no momento da venda (R$). */
  unitLaborCost: number | null;
  /** Imposto da venda no momento do registro (R$). */
  tax: number | null;
  ingredientId: number | null;
  /** Compra que atualizou o preço do ingrediente (embalagens e medida usadas). */
  purchase: { packs: number; packageSize: number; unit: Unit } | null;
  createdAt: string;
}
