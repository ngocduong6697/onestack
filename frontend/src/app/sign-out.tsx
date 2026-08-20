'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function SignOut() {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  return (
    <button
      type="button"
      disabled={pending}
      onClick={async () => {
        setPending(true)
        await fetch('/api/auth/logout', { method: 'POST' })
        router.replace('/login')
        router.refresh()
      }}
      className="text-sm text-muted hover:text-ink disabled:opacity-60"
    >
      {pending ? 'Signing out…' : 'Sign out'}
    </button>
  )
}
