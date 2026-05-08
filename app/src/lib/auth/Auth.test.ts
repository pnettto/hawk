import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/svelte'
import Auth from './Auth.svelte'

describe('Auth', () => {
  it('renders the password field and login button', () => {
    render(Auth)
    expect(screen.getByPlaceholderText(/password/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /log in/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /let me test it/i })).toBeInTheDocument()
  })
})
