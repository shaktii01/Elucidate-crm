import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { useEffect, type ReactNode } from 'react'
import { Toaster } from 'sonner'
import LeadsPage from '../features/leads/pages/LeadsPage.js'
import LoginPage from '../features/auth/LoginPage.js'
import { authApi } from '../features/auth/auth.api.js'
import { useAuthStore } from '../stores/auth.store.js'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: false, refetchOnWindowFocus: true } },
})

function ProtectedRoute({ children }: { children: ReactNode }) {
  const setUser = useAuthStore((state) => state.setUser)
  const auth = useQuery({ queryKey: ['auth', 'me'], queryFn: authApi.me })
  useEffect(() => { if (auth.data) setUser(auth.data) }, [auth.data, setUser])
  if (auth.isPending) return <main className="auth-loading"><span className="loading-spinner"/>Checking your session…</main>
  if (auth.isError) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<ProtectedRoute><LeadsPage /></ProtectedRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster position="bottom-right" richColors />
    </QueryClientProvider>
  )
}
