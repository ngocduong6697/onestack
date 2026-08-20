import { LoginForm } from './login-form'

export const metadata = { title: 'Sign in · OneStack' }

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-8 px-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">OneStack</h1>
        <p className="text-sm text-muted">An operating system for a one-person company.</p>
      </div>
      <LoginForm />
    </main>
  )
}
