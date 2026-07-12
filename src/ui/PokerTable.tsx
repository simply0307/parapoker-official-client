import { useMemo, useRef, useState } from 'react'
import { cardToString, type Card, type LegalAction, type PublicSeatView } from '../poker-engine'
import {
  LocalSinglePlayerController,
  type LocalSinglePlayerSnapshot,
} from '../table-controllers/local-single-player/LocalSinglePlayerController'

export function PokerTable() {
  const controllerRef = useRef<LocalSinglePlayerController | null>(null)
  if (!controllerRef.current) {
    controllerRef.current = new LocalSinglePlayerController()
  }

  const [snapshot, setSnapshot] = useState<LocalSinglePlayerSnapshot>(() => controllerRef.current!.getSnapshot())
  const [amounts, setAmounts] = useState<Record<string, number>>({})

  const heroSeat = snapshot.heroView.seats.find((seat) => seat.id === snapshot.heroView.heroSeatId)
  const opponentSeats = snapshot.heroView.seats.filter((seat) => seat.id !== snapshot.heroView.heroSeatId)
  const pendingSeat = snapshot.publicView.seats.find((seat) => seat.id === snapshot.publicView.pendingSeatId)
  const canStartNextHand = snapshot.canonicalStatus === 'waitingForHand'
  const matchWinner = snapshot.publicView.status === 'complete'
    ? snapshot.publicView.seats.find((seat) => seat.stack > 0)
    : undefined
  const toCall = heroSeat && snapshot.publicView.pendingSeatId === heroSeat.id
    ? Math.max(0, snapshot.publicView.currentBet - heroSeat.streetContribution)
    : 0
  const stackLead = getStackLead(snapshot.publicView.seats, snapshot.heroView.heroSeatId)
  const lastResult = getLastResultText(snapshot)

  const statusText = useMemo(() => {
    if (matchWinner) {
      return `${matchWinner.name} wins the match`
    }
    if (snapshot.publicView.status === 'waitingForHand') {
      return 'Hand complete'
    }
    const pending = snapshot.publicView.seats.find((seat) => seat.id === snapshot.publicView.pendingSeatId)
    return pending ? `${pending.name} to act` : 'Resolving hand'
  }, [matchWinner, snapshot.publicView.pendingSeatId, snapshot.publicView.seats, snapshot.publicView.status])

  function refresh() {
    setSnapshot(controllerRef.current!.getSnapshot())
  }

  function submit(command: HumanCommand) {
    controllerRef.current!.submitHumanAction(command)
    refresh()
  }

  function startNext() {
    controllerRef.current!.startNextHand()
    setAmounts({})
    refresh()
  }

  return (
    <main className="table-shell">
      <section className="scoreboard" aria-label="Match state">
        <div className="title-block">
          <p className="eyebrow">ParaPoker Play Money</p>
          <h1>Heads-Up No-Limit Hold&apos;em</h1>
        </div>
        <div className="match-summary">
          <div className="status-pill">{statusText}</div>
          <dl className="metric-grid" aria-label="Match metrics">
            <Metric label="Hand" value={snapshot.publicView.handNumber} />
            <Metric label="Pot" value={formatChips(snapshot.publicView.pot)} />
            <Metric label="To call" value={formatChips(toCall)} />
            <Metric label="Stack lead" value={stackLead} />
          </dl>
        </div>
      </section>

      <section className="felt" aria-label="Poker table">
        <div className="opponents">
          {opponentSeats.map((seat) => (
            <SeatPanel
              key={seat.id}
              seat={seat}
              cards={seat.revealedCards}
              hiddenCards={!seat.revealedCards}
              label="Opponent seat"
              active={pendingSeat?.id === seat.id}
            />
          ))}
        </div>

        <div className="board">
          <div className="pot">Pot {formatChips(snapshot.publicView.pot)}</div>
          <div className="community" aria-label="Community cards">
            {Array.from({ length: 5 }).map((_, index) => (
              <PlayingCard key={index} card={snapshot.publicView.communityCards[index]} placeholder="Board" />
            ))}
          </div>
          <div className="street">{snapshot.publicView.street ?? 'Waiting'}</div>
        </div>

        {heroSeat && (
          <SeatPanel
            seat={heroSeat}
            cards={snapshot.heroView.holeCards}
            label="Hero seat"
            active={pendingSeat?.id === heroSeat.id}
          />
        )}
      </section>

      <section className="controls" aria-label="Player actions">
        <div className="controls-header">
          <div>
            <h2>Actions</h2>
            <p>{lastResult ?? (pendingSeat ? `${pendingSeat.name} is next` : 'Resolving hand')}</p>
          </div>
          <span className="round-pill">{titleCase(snapshot.publicView.street ?? snapshot.publicView.status)}</span>
        </div>
        <div className="action-row">
          {snapshot.heroView.legalActions.length === 0 && !canStartNextHand && (
            <span className="muted">Waiting for the table authority.</span>
          )}
          {snapshot.heroView.legalActions.map((action) => (
            <ActionControl
              key={action.type}
              action={action}
              amount={amounts[action.type]}
              setAmount={(amount) => setAmounts((current) => ({ ...current, [action.type]: amount }))}
              submit={submit}
            />
          ))}
          {canStartNextHand && (
            <button type="button" className="primary" onClick={startNext}>
              Next hand
            </button>
          )}
        </div>
        {snapshot.lastError && <p className="error">{snapshot.lastError}</p>}
      </section>

      <section className="history" aria-label="Hand history">
        <div className="section-heading">
          <h2>Hand history</h2>
          <span>{snapshot.heroView.events.length} events</span>
        </div>
        <ol>
          {snapshot.heroView.events.slice(-10).map((event) => (
            <li key={event.eventId}>{describeEvent(event)}</li>
          ))}
        </ol>
      </section>
    </main>
  )
}

function SeatPanel({
  seat,
  cards,
  hiddenCards = false,
  label,
  active = false,
}: {
  seat: PublicSeatView
  cards?: PublicSeatView['revealedCards']
  hiddenCards?: boolean
  label: string
  active?: boolean
}) {
  return (
    <div className={`seat ${seat.id}${active ? ' active-seat' : ''}`} aria-label={label}>
      <div className="seat-meta">
        <strong>{seat.name}</strong>
        <span>{formatChips(seat.stack)}</span>
      </div>
      <div className="badges">
        {seat.isDealer && <span>Button</span>}
        {seat.isSmallBlind && <span>SB</span>}
        {seat.isBigBlind && <span>BB</span>}
        <span>{titleCase(seat.status)}</span>
        {active && <span>Acting</span>}
      </div>
      <div className="hole-cards">
        {hiddenCards ? (
          <>
            <PlayingCard hidden />
            <PlayingCard hidden />
          </>
        ) : (
          <>
            <PlayingCard card={cards?.[0]} placeholder="Card" />
            <PlayingCard card={cards?.[1]} placeholder="Card" />
          </>
        )}
      </div>
      <div className="contribution">Bet {formatChips(seat.streetContribution)}</div>
    </div>
  )
}

function PlayingCard({ card, hidden = false, placeholder = 'Empty' }: { card?: Card; hidden?: boolean; placeholder?: string }) {
  if (hidden) {
    return <div className="card back" aria-label="Hidden card" />
  }
  if (!card) {
    return <div className="card empty">{placeholder}</div>
  }
  const red = card.suit === 'hearts' || card.suit === 'diamonds'
  return <div className={`card ${red ? 'red' : 'black'}`}>{cardToString(card)}</div>
}

function ActionControl({
  action,
  amount,
  setAmount,
  submit,
}: {
  action: LegalAction
  amount?: number
  setAmount: (amount: number) => void
  submit: (command: HumanCommand) => void
}) {
  if (action.type === 'bet' || action.type === 'raise') {
    const selectedAmount = amount ?? action.min
    return (
      <label className="amount-control">
        <span>{titleCase(action.type)}</span>
        <input
          type="range"
          min={action.min}
          max={action.max}
          aria-label={`${titleCase(action.type)} amount`}
          value={selectedAmount}
          onChange={(event) => setAmount(Number(event.target.value))}
        />
        <button type="button" onClick={() => submit({ type: action.type, amount: selectedAmount })}>
          {titleCase(action.type)} {formatChips(selectedAmount)}
        </button>
      </label>
    )
  }

  if (action.type === 'call') {
    return (
      <button type="button" onClick={() => submit({ type: 'call' })}>
        Call {action.amount}
      </button>
    )
  }

  if (action.type === 'allIn') {
    return (
      <button type="button" className="danger" onClick={() => submit({ type: 'allIn' })}>
        All-in {action.amount}
      </button>
    )
  }

  return (
    <button type="button" onClick={() => submit({ type: action.type })}>
      {titleCase(action.type)}
    </button>
  )
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function getStackLead(seats: PublicSeatView[], heroSeatId: string): string {
  const hero = seats.find((seat) => seat.id === heroSeatId)
  const opponent = seats.find((seat) => seat.id !== heroSeatId)
  if (!hero || !opponent) {
    return 'Even'
  }
  const difference = hero.stack - opponent.stack
  if (difference === 0) {
    return 'Even'
  }
  return difference > 0 ? `You +${difference}` : `${opponent.name} +${Math.abs(difference)}`
}

function getLastResultText(snapshot: LocalSinglePlayerSnapshot): string | undefined {
  const awarded = [...snapshot.heroView.events].reverse().find((event) => event.type === 'potAwarded')
  if (!awarded || snapshot.publicView.status === 'handInProgress') {
    return undefined
  }
  return `Last pot: ${awarded.payload.winners.map((winner) => `${winner.seatId} won ${winner.amount}`).join(', ')}`
}

function formatChips(amount: number): string {
  return `${amount}`
}

function titleCase(value: string): string {
  return value
    .split(/[-\s]/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

function describeEvent(event: LocalSinglePlayerSnapshot['heroView']['events'][number]): string {
  switch (event.type) {
    case 'handStarted':
      return `Hand ${event.handId} started; button is ${event.payload.dealerSeatId}.`
    case 'blindPosted':
      return `${event.payload.seatId} posted ${event.payload.blind} blind for ${event.payload.amount}.`
    case 'holeCardsDealt':
      return `Your hole cards: ${event.payload.cards.map(cardToString).join(' ')}.`
    case 'actionApplied':
      return `${event.payload.seatId} ${event.payload.action} ${
        event.payload.amount ? `for ${event.payload.amount}` : ''
      }.`
    case 'streetAdvanced':
      return `${event.payload.street} dealt.`
    case 'showdown':
      return `Showdown: ${Object.keys(event.payload.revealedCards).join(', ')} revealed.`
    case 'potAwarded':
      return `Pot awarded to ${event.payload.winners
        .map((winner) => `${winner.seatId} (${winner.amount})`)
        .join(', ')}.`
    case 'matchComplete':
      return `${event.payload.winnerSeatId} wins the match.`
  }
}

type HumanCommand =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  | { type: 'bet'; amount: number }
  | { type: 'raise'; amount: number }
  | { type: 'allIn' }
