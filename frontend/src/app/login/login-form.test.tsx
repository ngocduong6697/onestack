import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const replace = vi.fn()
const refresh = vi.fn()

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, refresh }) }))

const { LoginForm } = await import('./login-form')

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function submit(email = 'founder@onestack.test', password = 'a sufficiently long password') {
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: email } })
  fireEvent.change(screen.getByLabelText(/password/i), { target: { value: password } })
  fireEvent.submit(screen.getByRole('button', { name: /sign in/i }))
}

describe('LoginForm', () => {
  beforeEach(() => {
    replace.mockClear()
    refresh.mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('posts to this app’s own origin, never the API directly', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: 'user-1' }))
    vi.stubGlobal('fetch', fetchMock)
    render(<LoginForm />)

    submit()

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/auth/login')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({
      email: 'founder@onestack.test',
      password: 'a sufficiently long password',
    })
  })

  it('goes to the dashboard on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { id: 'user-1' })))
    render(<LoginForm />)

    submit()

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'))
    expect(refresh).toHaveBeenCalled()
  })

  /** The API says the same thing whether or not the account exists. */
  it('shows the message the API returned', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(401, {
          error: { code: 'unauthorized', message: 'Invalid email or password' },
        }),
      ),
    )
    render(<LoginForm />)

    submit()

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password')
    expect(replace).not.toHaveBeenCalled()
  })

  it('falls back to a generic message when the body is not what it expected', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nonsense', { status: 500 })))
    render(<LoginForm />)

    submit()

    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong')
  })

  it('disables the button while the request is in flight', async () => {
    let settle: (value: Response) => void = () => {}
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(new Promise<Response>((resolve) => (settle = resolve))),
    )
    render(<LoginForm />)

    submit()

    const button = screen.getByRole('button')
    await waitFor(() => expect(button).toBeDisabled())
    expect(button).toHaveTextContent(/signing in/i)

    settle(jsonResponse(200, { id: 'user-1' }))
    await waitFor(() => expect(replace).toHaveBeenCalled())
  })

  it('lets the visitor try again after a failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(jsonResponse(401, { error: { message: 'Invalid email or password' } })),
    )
    render(<LoginForm />)

    submit()

    await screen.findByRole('alert')
    expect(screen.getByRole('button')).toBeEnabled()
  })

  it('clears a previous error when trying again', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { error: { message: 'Invalid email or password' } }))
      .mockResolvedValueOnce(jsonResponse(200, { id: 'user-1' }))
    vi.stubGlobal('fetch', fetchMock)
    render(<LoginForm />)

    submit()
    await screen.findByRole('alert')

    submit()
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })
})
