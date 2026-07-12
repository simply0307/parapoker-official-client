import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PokerTable } from '../../src/ui/PokerTable'

describe('PokerTable', () => {
  it('renders a playable table surface', () => {
    render(<PokerTable />)

    expect(screen.getByText("Heads-Up No-Limit Hold'em")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /call/i })).toBeInTheDocument()
    expect(screen.getByLabelText('Poker table')).toBeInTheDocument()
  })
})
