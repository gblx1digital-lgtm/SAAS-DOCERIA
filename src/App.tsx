import { useEffect, useState } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import {
  BarChart3, BookOpen, Cake, Calculator, LayoutDashboard, Menu, Settings as SettingsIcon, Store, Wallet, Wheat, X,
} from 'lucide-react';
import { useStore } from './lib/store.tsx';
import { cx, Notice } from './components/ui.tsx';
import Dashboard from './pages/Dashboard.tsx';
import Ingredients from './pages/Ingredients.tsx';
import Recipes from './pages/Recipes.tsx';
import Products from './pages/Products.tsx';
import Pricing from './pages/Pricing.tsx';
import Market from './pages/Market.tsx';
import Finance from './pages/Finance.tsx';
import SettingsPage from './pages/Settings.tsx';

const NAV = [
  { to: '/', label: 'Painel', icon: LayoutDashboard },
  { section: 'Produção' },
  { to: '/ingredientes', label: 'Ingredientes', icon: Wheat },
  { to: '/receitas', label: 'Receitas', icon: BookOpen },
  { to: '/produtos', label: 'Produtos', icon: Cake },
  { section: 'Preços' },
  { to: '/precificacao', label: 'Precificação', icon: Calculator },
  { to: '/mercado', label: 'Mercado', icon: Store },
  { section: 'Gestão' },
  { to: '/financeiro', label: 'Financeiro', icon: Wallet },
  { to: '/configuracoes', label: 'Custos e configurações', icon: SettingsIcon },
] as const;

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { settings } = useStore();
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-2.5 px-4">
        <div className="flex size-7 items-center justify-center rounded-lg bg-ink text-white">
          <BarChart3 className="size-3.5" />
        </div>
        <div className="min-w-0 leading-tight">
          <div className="truncate text-[13.5px] font-semibold text-ink">{settings.businessName || 'Minha confeitaria'}</div>
          <div className="text-[11.5px] text-muted">Gestão e precificação</div>
        </div>
      </div>
      <nav className="flex-1 space-y-0.5 px-2 py-2">
        {NAV.map((n, i) =>
          'section' in n ? (
            <div key={i} className="px-2.5 pb-1 pt-4 text-[11px] font-medium uppercase tracking-[0.06em] text-faint">
              {n.section}
            </div>
          ) : (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              onClick={onNavigate}
              className={({ isActive }) =>
                cx(
                  'flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium transition-colors',
                  isActive ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(28,25,23,.08)] ring-1 ring-line' : 'text-ink-2 hover:bg-line/50',
                )
              }
            >
              <n.icon className="size-4 text-muted" strokeWidth={1.8} />
              {n.label}
            </NavLink>
          ),
        )}
      </nav>
      <div className="border-t border-line px-4 py-3 text-[11.5px] text-faint">Dados salvos no banco local do sistema.</div>
    </div>
  );
}

export default function App() {
  const { loading, error } = useStore();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => window.scrollTo(0, 0), [loc.pathname]);
  const currentLabel =
    NAV.flatMap((n) => ('to' in n ? [n] : [])).find((n) => (n.to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(n.to)))?.label ?? '';

  return (
    <div className="min-h-full lg:pl-60">
      <aside className="fixed inset-y-0 left-0 hidden w-60 border-r border-line bg-canvas lg:block">
        <Sidebar />
      </aside>

      {/* Mobile */}
      <div className="sticky top-0 z-30 flex h-12 items-center justify-between border-b border-line bg-canvas/90 px-4 backdrop-blur lg:hidden">
        <button className="-ml-1.5 inline-flex size-8 items-center justify-center rounded-md hover:bg-subtle" onClick={() => setOpen(true)} aria-label="Abrir menu">
          <Menu className="size-4.5" />
        </button>
        <span className="text-[13.5px] font-semibold">{currentLabel}</span>
        <span className="size-8" />
      </div>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="anim-fade absolute inset-0 bg-ink/25" onClick={() => setOpen(false)} />
          <div className="anim-pop absolute inset-y-0 left-0 w-72 border-r border-line bg-canvas">
            <button className="absolute right-3 top-3 inline-flex size-8 items-center justify-center rounded-md hover:bg-subtle" onClick={() => setOpen(false)} aria-label="Fechar menu">
              <X className="size-4" />
            </button>
            <Sidebar onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}

      <main className="mx-auto max-w-[1240px] px-4 py-6 sm:px-6 lg:px-10 lg:py-9">
        {error && (
          <Notice tone="neg" className="mb-5">
            {error}
          </Notice>
        )}
        {loading ? (
          <div className="flex h-[60vh] items-center justify-center text-muted">
            <span className="mr-2 size-4 animate-spin rounded-full border-2 border-current border-r-transparent" /> Carregando…
          </div>
        ) : (
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/ingredientes" element={<Ingredients />} />
            <Route path="/receitas" element={<Recipes />} />
            <Route path="/produtos" element={<Products />} />
            <Route path="/precificacao" element={<Pricing />} />
            <Route path="/mercado" element={<Market />} />
            <Route path="/financeiro" element={<Finance />} />
            <Route path="/configuracoes" element={<SettingsPage />} />
            <Route path="*" element={<Notice>Página não encontrada.</Notice>} />
          </Routes>
        )}
      </main>
    </div>
  );
}
