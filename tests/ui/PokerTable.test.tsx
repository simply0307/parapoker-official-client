import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PokerTable } from '../../src/ui/PokerTable'

describe('PokerTable', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('starts on setup without creating a poker table', () => {
    render(<PokerTable />)

    expect(screen.getByText('Start a Local Solo Match')).toBeInTheDocument()
    expect(screen.getByLabelText('Local match setup')).toBeInTheDocument()
    expect(screen.queryByLabelText('Poker table')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /call/i })).not.toBeInTheDocument()
  })

  it('starts a playable heads-up match after explicit setup submission', async () => {
    render(<PokerTable />)

    fireEvent.click(screen.getByRole('button', { name: 'Start Match' }))

    expect((await screen.findAllByText("Heads-Up No-Limit Hold'em")).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /call/i })).toBeInTheDocument()
    expect(screen.getByLabelText('Poker table')).toBeInTheDocument()
    expect(screen.getByText('Seed heads-up-solo')).toBeInTheDocument()
    expect(screen.getByLabelText('Table flow')).toHaveTextContent('Maven posts big blind 2')
    expect(screen.getByLabelText('Table utility bar')).toBeInTheDocument()
    expect(screen.getByLabelText('Player actions')).toHaveClass('action-dock')
    expect(screen.getByLabelText('Table 1 window')).toHaveClass('active-table-window')
    expect(screen.getByLabelText('Table 1 stage')).toContainElement(screen.getByLabelText('Poker table'))
    expect(screen.getByLabelText('Table 1 footer')).toContainElement(screen.getByLabelText('Player actions'))
    expect(screen.getByLabelText('Opponent seat')).toHaveClass('opponent-1')
    expect(screen.getByLabelText('Hero seat')).toHaveClass('hero')
    expect(screen.getByLabelText('Maven street contribution')).toHaveTextContent(/^2$/)
  })

  it('uses the signed-in profile name throughout a newly created table', async () => {
    render(<PokerTable playerIdentity={{
      profileId: 'profile-river-port',
      accountId: 'account-river-port',
      screenName: 'RiverPort',
      avatarUrl: null,
    }} />)

    expect(screen.getByLabelText('Current player identity')).toHaveTextContent('Playing as RiverPort')
    fireEvent.click(screen.getByRole('button', { name: 'Start Match' }))

    expect(await screen.findByLabelText('Hero seat')).toHaveTextContent('RiverPort')
    fireEvent.click(screen.getByRole('button', { name: 'Call 1' }))
    await waitFor(() => {
      expect(screen.getByLabelText('Table flow')).toHaveTextContent('RiverPort calls 1')
    })
    expect(screen.getByLabelText('Poker table')).not.toHaveTextContent('You')
  })

  it('does not create a guest-named table while a signed-in profile is still loading', () => {
    render(<PokerTable identityResolved={false} />)

    fireEvent.click(screen.getByRole('button', { name: 'Start Match' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Player identity is still loading.')
    expect(screen.queryByLabelText('Poker table')).not.toBeInTheDocument()
  })

  it('validates setup before creating a match', () => {
    render(<PokerTable />)

    fireEvent.change(screen.getByLabelText('BB'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start Match' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Big blind must be a positive whole number.')
    expect(screen.queryByLabelText('Poker table')).not.toBeInTheDocument()
  })

  it('trims entered seeds and allows random seeds without an entered value', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<PokerTable />)

    fireEvent.change(screen.getByLabelText('Seed'), { target: { value: '  trimmed-seed  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start Match' }))

    expect(await screen.findByText('Seed trimmed-seed')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Concede match' }))
    fireEvent.change(await screen.findByLabelText('Seed'), { target: { value: '' } })
    fireEvent.click(screen.getByText('Random local seed'))
    expect(screen.getByLabelText('Seed')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Start Match' }))

    expect(await screen.findByText(/Seed local-/)).toBeInTheDocument()
  })

  it('lets players tune raises with the slider, wheel, and typed amount after the match starts', async () => {
    render(<PokerTable />)

    fireEvent.click(screen.getByRole('button', { name: 'Start Match' }))

    const raiseSlider = await screen.findByLabelText('Raise amount slider')
    const raiseInput = screen.getByLabelText('Raise amount entry')

    expect(raiseInput).toHaveValue(4)

    fireEvent.wheel(raiseSlider, { deltaY: -100 })
    expect(raiseInput).toHaveValue(5)

    fireEvent.change(raiseInput, { target: { value: '12' } })
    expect(raiseSlider).toHaveValue('12')
    expect(screen.getByRole('button', { name: 'Raise 12' })).toBeInTheDocument()
  })

  it('can start a six-max solo table with one hero and five NPC seats', async () => {
    render(<PokerTable />)

    fireEvent.click(screen.getByRole('button', { name: 'Six-max' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start Match' }))

    expect((await screen.findAllByText("Six-Max No-Limit Hold'em")).length).toBeGreaterThan(0)
    expect(screen.getAllByLabelText('Opponent seat')).toHaveLength(5)
    expect(screen.getByText('Vega')).toBeInTheDocument()
    expect(screen.getAllByLabelText('Opponent seat')[0]).toHaveAttribute('title', 'Measured caller - Steady')
    expect(screen.getByLabelText('Hero seat')).toHaveTextContent('You')
    expect(screen.getByLabelText('Poker table')).toHaveClass('six-max-layout')
    expect(screen.getAllByLabelText('Opponent seat').map((seat) => seat.className)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('opponent-1'),
        expect.stringContaining('opponent-2'),
        expect.stringContaining('opponent-3'),
        expect.stringContaining('opponent-4'),
        expect.stringContaining('opponent-5'),
      ]),
    )
    expect(screen.getByLabelText('Hero seat')).toHaveTextContent('BTN')
    for (const position of ['SB', 'BB', 'UTG', 'HJ', 'CO']) {
      expect(screen.getByLabelText('Poker table')).toHaveTextContent(position)
    }
    expect(screen.getByLabelText('Player actions')).toHaveTextContent(/Call|Check|Raise|Bet|Waiting/)
  })

  it('switches between one, two, and four table window layouts without creating extra sessions', async () => {
    const { container } = render(<PokerTable />)

    fireEvent.click(screen.getByRole('button', { name: 'Start Match' }))
    expect(await screen.findByLabelText('Table windows')).toHaveClass('layout-1')
    expect(screen.getAllByTestId('table-window')).toHaveLength(1)
    expect(container.querySelectorAll('.table-window-header')).toHaveLength(1)
    expect(container.querySelectorAll('.table-stage')).toHaveLength(1)
    expect(container.querySelectorAll('.table-window-footer')).toHaveLength(1)

    fireEvent.change(screen.getByLabelText('Table layout'), { target: { value: '2' } })
    expect(screen.getByLabelText('Table windows')).toHaveClass('layout-2')
    expect(screen.getAllByTestId('table-window')).toHaveLength(2)
    expect(container.querySelectorAll('.table-window-header')).toHaveLength(2)
    expect(container.querySelectorAll('.table-stage')).toHaveLength(2)
    expect(container.querySelectorAll('.table-window-footer')).toHaveLength(2)
    expect(screen.getByLabelText('Inactive table slot 2')).toHaveTextContent('No active session')
    expect(screen.getByLabelText('Table 2 footer')).toHaveTextContent('No active session')
    expect(screen.getAllByLabelText('Poker table')).toHaveLength(1)
    expect(screen.getByLabelText('Table 1 footer')).toContainElement(screen.getByLabelText('Player actions'))
    expect(screen.getByLabelText('Table 1 stage')).toContainElement(screen.getByLabelText('Poker table'))

    fireEvent.change(screen.getByLabelText('Table layout'), { target: { value: '4' } })
    expect(screen.getByLabelText('Table windows')).toHaveClass('layout-4')
    expect(screen.getAllByTestId('table-window')).toHaveLength(4)
    expect(container.querySelectorAll('.table-window-header')).toHaveLength(4)
    expect(container.querySelectorAll('.table-stage')).toHaveLength(4)
    expect(container.querySelectorAll('.table-window-footer')).toHaveLength(4)
    expect(screen.getByLabelText('Inactive table slot 4')).toBeInTheDocument()
    expect(screen.getAllByLabelText('Poker table')).toHaveLength(1)
  })

  it('shows a verified hand-result panel after an uncontested pot', async () => {
    render(<PokerTable />)

    fireEvent.click(screen.getByRole('button', { name: 'Start Match' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Fold' }))

    const result = await screen.findByLabelText('Latest hand result')
    expect(screen.getByText('Hand result')).toBeInTheDocument()
    expect(result).toHaveTextContent('Pot awarded')
    expect(result).toHaveTextContent('Maven wins 3')
    expect(result).not.toHaveTextContent('You wins')
    expect(screen.queryByLabelText('Revealed cards')).not.toBeInTheDocument()
  })

  it('updates the table-flow queue from verified events after player and NPC actions', async () => {
    render(<PokerTable />)

    fireEvent.click(screen.getByRole('button', { name: 'Start Match' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Call 1' }))

    await waitFor(() => {
      expect(screen.getByLabelText('Table flow')).toHaveTextContent('You call 1')
    })
    const flow = screen.getByLabelText('Table flow')
    expect(flow).toHaveTextContent('You call 1')
    expect(flow).toHaveTextContent('Maven')
    expect(flow).not.toHaveTextContent('posts big blind')
  })

  it('keeps opponent cards hidden and hero cards visible before showdown', async () => {
    render(<PokerTable />)

    fireEvent.click(screen.getByRole('button', { name: 'Start Match' }))

    expect(await screen.findByLabelText('Hero seat')).toHaveTextContent(/\w[cdhs]/)
    expect(screen.getByLabelText('Opponent seat').querySelectorAll('.card.back')).toHaveLength(2)
  })

  it('collapses and expands stored hand history', async () => {
    render(<PokerTable />)

    fireEvent.click(screen.getByRole('button', { name: 'Start Match' }))

    const toggle = await screen.findByRole('button', { name: /History/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Your hole cards:')).not.toBeInTheDocument()

    fireEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Hand history')).toBeInTheDocument()
    expect(screen.getByText(/Your hole cards:/)).toBeInTheDocument()
  })

  it('applies seat presentation classes for acting and folded states', async () => {
    render(<PokerTable />)

    fireEvent.click(screen.getByRole('button', { name: 'Start Match' }))

    expect(await screen.findByLabelText('Hero seat')).toHaveClass('acting')
    fireEvent.click(screen.getByRole('button', { name: 'Fold' }))

    await waitFor(() => {
      expect(screen.getByLabelText('Hero seat')).toHaveClass('status-folded')
    })
  })

  it('requires confirmation before conceding an active match', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<PokerTable />)

    fireEvent.click(screen.getByRole('button', { name: 'Start Match' }))
    expect(await screen.findByLabelText('Poker table')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Concede match' }))

    expect(confirm).toHaveBeenCalledWith('Concede this match and leave the table?')
    expect(screen.getByLabelText('Poker table')).toBeInTheDocument()

    confirm.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'Concede match' }))

    expect(await screen.findByText('Start a Local Solo Match')).toBeInTheDocument()
    expect(screen.queryByLabelText('Poker table')).not.toBeInTheDocument()
  })

  it('shows a match result scene and supports same-seed and random rematches', async () => {
    render(<PokerTable />)

    fireEvent.click(screen.getByText('Random local seed'))
    fireEvent.change(screen.getByLabelText('Stack'), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText('SB'), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText('BB'), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText('Seed'), { target: { value: 'instant-result' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start Match' }))

    expect(await playUntilSessionResult()).toBeInTheDocument()
    expect(screen.getByText('Seed')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Download Hand History CSV' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'View in Hand Histories' })).toBeInTheDocument()
    expect(screen.getByText('Package checksum')).toBeInTheDocument()
    const firstSeedLine = screen.getByText(/Seed local-/)
    const firstSeed = firstSeedLine.textContent?.replace('Seed ', '') ?? ''

    fireEvent.click(screen.getByRole('button', { name: 'Rematch same seed' }))
    expect(await screen.findByText(`Seed ${firstSeed}`)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'New random match' }))
    expect(await screen.findByText(/Seed local-/)).toBeInTheDocument()
  })
})

async function playUntilSessionResult(maxHands = 20): Promise<HTMLElement> {
  for (let hand = 0; hand < maxHands; hand += 1) {
    await waitFor(() => {
      expect(
        screen.queryByLabelText('Session result') ??
        screen.queryByRole('button', { name: 'Next hand' }),
      ).not.toBeNull()
    })
    const result = screen.queryByLabelText('Session result')
    if (result) {
      return result
    }

    const nextHand = screen.queryByRole('button', { name: 'Next hand' })
    if (nextHand) {
      const previousHandNumber = getDisplayedHandNumber()
      fireEvent.click(nextHand)
      await waitFor(() => {
        const sessionResult = screen.queryByLabelText('Session result')
        if (sessionResult) {
          return
        }
        expect(getDisplayedHandNumber()).not.toBe(previousHandNumber)
      })
    }
  }

  return screen.findByLabelText('Session result')
}

function getDisplayedHandNumber(): string | undefined {
  const utilityBar = screen.queryByLabelText('Table utility bar')
  const handLabel = utilityBar?.querySelector('dt')
  return handLabel?.textContent === 'Hand'
    ? handLabel.parentElement?.querySelector('dd')?.textContent ?? undefined
    : undefined
}
