import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import { HOUR_MS } from './queries/persistentCache'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true,
      staleTime: HOUR_MS,
      gcTime: HOUR_MS,
      retry: (failureCount, error) => {
        const status = typeof error === 'object' && error && 'status' in error
          ? Number(error.status) : 0
        return ![400, 401, 403, 404, 409, 422].includes(status) && failureCount < 2
      },
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </AppErrorBoundary>
  </StrictMode>,
)
