import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

type AppErrorBoundaryProps = { children: ReactNode }
type AppErrorBoundaryState = { hasError: boolean }

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('AralForge failed to render.', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="app-main app-error-screen">
          <section aria-labelledby="app-error-title" className="app-error-screen__panel" role="alert">
            <p className="eyebrow">AralForge</p>
            <h1 id="app-error-title">This page could not be opened</h1>
            <p>Reload the page to try again.</p>
            <button className="button button--primary" onClick={() => window.location.reload()} type="button">
              Reload
            </button>
          </section>
        </main>
      )
    }

    return this.props.children
  }
}
