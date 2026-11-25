import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Tela inteira (erro fora das páginas) ou só a área da página. */
  fullPage?: boolean;
}

interface State {
  error: Error | null;
}

/** Mostra uma mensagem com opção de recarregar em vez de deixar a tela em branco. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Erro na tela:', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className={this.props.fullPage ? 'flex min-h-full items-center justify-center p-6' : 'py-10'}>
        <div className="mx-auto max-w-md rounded-xl border border-line bg-surface p-6 text-center shadow-[0_1px_2px_rgba(28,25,23,.04)]">
          <div className="text-[15px] font-semibold text-ink">Algo deu errado nesta tela</div>
          <p className="mt-2 text-[13px] text-muted">
            Seus dados estão salvos. Recarregue a página para continuar. Se o problema se repetir, envie uma foto desta
            mensagem para o suporte.
          </p>
          <pre className="mt-3 max-h-28 overflow-auto rounded-md bg-subtle p-2 text-left text-[11px] text-ink-2 whitespace-pre-wrap">
            {error.message}
          </pre>
          <button
            className="mt-4 inline-flex h-8.5 items-center justify-center rounded-md bg-ink px-3 text-[13px] font-medium text-white hover:bg-ink-2"
            onClick={() => window.location.reload()}
          >
            Recarregar página
          </button>
        </div>
      </div>
    );
  }
}
