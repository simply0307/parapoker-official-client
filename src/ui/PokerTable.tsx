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
  const canStartNextHand = snapshot.canonicalStatus === 'waitingForHand'
  const matchWinner = snapshot.publicView.status === 'complete'
    ? snapshot.publicView.seats.find((seat) => seat.stack > 0)
    : undefined

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
        <div>
          <p className="eyebrow">ParaPoker Play Money</p>
          <h1>Heads-Up No-Limit Hold&apos;em</h1>
        </div>
        <div className="status-pill">{statusText}</div>
      </section>

      <section className="felt" aria-label="Poker table">
        <div className="opponents">
          {opponentSeats.map((seat) => (
            <SeatPanel key={seat.id} seat={seat} cards={seat.revealedCards} hiddenCards={!seat.revealedCards} />
          ))}
        </div>

        <div className="board">
          <div className="pot">Pot {snapshot.publicView.pot}</div>
          <div className="community" aria-label="Community cards">
            {Array.from({ length: 5 }).map((_, index) => (
              <PlayingCard key={index} card={snapshot.publicView.communityCards[index]} placeholder="Board" />
            ))}
          </div>
          <div className="street">{snapshot.publicView.street ?? 'Waiting'}</div>
        </div>

        {heroSeat && <SeatPanel seat={heroSeat} cards={snapshot.heroView.holeCards} />}
      </section>

      <section className="controls" aria-label="Player actions">
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
        <h2>Hand history</h2>
        <ol>
          {snapshot.heroView.events.slice(-10).map((event, index) => (
            <li key={`${event.type}-${index}`}>{describeEvent(event)}</li>
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
}: {
  seat: PublicSeatView
  cards?: PublicSeatView['revealedCards']
  hiddenCards?: boolean
}) {
  return (
    <div className={`seat ${seat.id}`}>
      <div className="seat-meta">
        <strong>{seat.name}</strong>
        <span>{seat.stack} chips</span>
      </div>
      <div className="badges">
        {seat.isDealer && <span>Button</span>}
        {seat.isSmallBlind && <span>SB</span>}
        {seat.isBigBlind && <span>BB</span>}
        <span>{seat.status}</span>
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
      <div className="contribution">Bet {seat.streetContribution}</div>
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
        <span>{action.type}</span>
        <input
          type="range"
          min={action.min}
          max={action.max}
          value={selectedAmount}
          onChange={(event) => setAmount(Number(event.target.value))}
        />
        <button type="button" onClick={() => submit({ type: action.type, amount: selectedAmount })}>
          {action.type} {selectedAmount}
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
      {action.type}
    </button>
  )
}

function describeEvent(event: LocalSinglePlayerSnapshot['heroView']['events'][number]): string {
  switch (event.type) {
    case 'handStarted':
      return `Hand ${event.handId} started; button is ${event.dealerSeatId}.`
    case 'blindPosted':
      return `${event.seatId} posted ${event.blind} blind for ${event.amount}.`
    case 'holeCardsDealt':
      return `Your hole cards: ${event.cards.map(cardToString).join(' ')}.`
    case 'actionApplied':
      return `${event.seatId} ${event.action} ${event.amount ? `for ${event.amount}` : ''}.`
    case 'streetAdvanced':
      return `${event.street} dealt.`
    case 'showdown':
      return `Showdown: ${Object.keys(event.revealedCards).join(', ')} revealed.`
    case 'potAwarded':
      return `Pot awarded to ${event.winners.map((winner) => `${winner.seatId} (${winner.amount})`).join(', ')}.`
    case 'matchComplete':
      return `${event.winnerSeatId} wins the match.`
  }
}

type HumanCommand =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  | { type: 'bet'; amount: number }
  | { type: 'raise'; amount: number }
  | { type: 'allIn' }
