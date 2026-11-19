import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { ArrowRight, LockKeyhole, Mail } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { authApi } from './auth.api.js'
import { apiErrorMessage } from '../../lib/api-client.js'
import { useAuthStore } from '../../stores/auth.store.js'

const loginSchema = z.object({ identifier: z.string().trim().min(1, 'Enter your employee ID or email'), password: z.string().min(1, 'Enter your password') })
type LoginValues = z.infer<typeof loginSchema>

export default function LoginPage() {
  const navigate = useNavigate()
  const setUser = useAuthStore((state) => state.setUser)
  const form = useForm<LoginValues>({ resolver: zodResolver(loginSchema) })
  const login = useMutation({
    mutationFn: (values: LoginValues) => authApi.login(values.identifier, values.password),
    onSuccess: (user) => { setUser(user); try { localStorage.setItem('crm:last-section', 'Dashboard') } catch { /* Storage may be disabled. */ }; navigate('/', { replace: true }) },
  })
  return (
    <main className="login-screen">
      <section className="login-card">
        <div className="login-brand"><img className="brand-mark" src="/brand-logo.png" alt=""/><b>Elucidate tech</b></div>
        <p className="eyebrow">SALES WORKSPACE</p><h1>Welcome back</h1><p className="login-copy">Sign in to manage your leads and follow-ups.</p>
        <form onSubmit={form.handleSubmit((values) => login.mutate(values))}>
          <label>Employee ID or email<span className="login-input"><Mail size={17}/><input autoComplete="username" placeholder="EMP-001 or you@company.com" {...form.register('identifier')}/></span>{form.formState.errors.identifier && <small className="login-error">{form.formState.errors.identifier.message}</small>}</label>
          <label>Password / 6-digit PIN<span className="login-input"><LockKeyhole size={17}/><input type="password" autoComplete="current-password" placeholder="Enter your PIN or password" {...form.register('password')}/></span>{form.formState.errors.password && <small className="login-error">{form.formState.errors.password.message}</small>}</label>
          {login.isError && <div className="login-alert" role="alert">{apiErrorMessage(login.error, 'Sign-in failed. Check the API connection and your credentials.')}</div>}
          <button className="button button-primary login-submit" disabled={login.isPending}>{login.isPending ? 'Signing in…' : <>Sign in <ArrowRight size={16}/></>}</button>
        </form>
        <p className="login-security">Protected by secure session cookies</p>
      </section>
    </main>
  )
}
