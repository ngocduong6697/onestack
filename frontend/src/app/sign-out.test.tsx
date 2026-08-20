import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const replace = vi.fn()
const refresh = vi.fn()

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, refresh }) }))

const { SignOut } = await import('./sign-out')

describe('SignOut', () => {
  beforeEach(() => {
    replace.mockClear()
    refresh.mockClear()
  })

  it('posts to the proxy and returns to the login page', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<SignOut />)

    fireEvent.click(screen.getByRole('button', { name: /sign out/i }))

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'))
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' })
    expect(refresh).toHaveBeenCalled()
  })

  it('disables itself while signing out', async () => {
    let settle: (value: Response) => void = () => {}
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(new Promise<Response>((resolve) => (settle = resolve))),
    )
    render(<SignOut />)

    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => expect(screen.getByRole('button')).toBeDisabled())
    expect(screen.getByRole('button')).toHaveTextContent(/signing out/i)

    settle(new Response(null, { status: 204 }))
    await waitFor(() => expect(replace).toHaveBeenCalled())
  })
})
