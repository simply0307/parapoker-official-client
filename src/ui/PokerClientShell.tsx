import type { Dispatch, SetStateAction, WheelEvent } from 'react'
import { cardToString, type Card, type LegalAction, type PublicSeatView } from '../poker-engine'
import { localNpcPresentation, localNpcPresentationForDefinition } from '../npc/roster'
import type { LocalSinglePlayerSnapshot } from '../table-controllers/local-single-player/LocalSinglePlayerController'
import type { LocalSoloSessionSnapshot } from '../table-controllers/local-single-player/LocalSoloSession'

export type TableWindowLayout = '1' | '2' | '4'

export interface HandResultSummary {
  label: string
  winners: Array<{
    name: string
    amount: number
    handName?: string
    cards?: Card[]
  }>
  revealed: Array<{
    name: string
    cards: Card[]
  }>
}

export interface PresentationEvent {
  id: string
  text: string
}

export type HumanCommand =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  | { type: 'bet'; amount: number }
  | { type: 'raise'; amount: number }
  | { type: 'allIn' }

type SoloScene = 'setup' | 'playing' | 'betweenHand' | 'matchResult'

export interface PokerClientShellProps {
  scene: SoloScene
  snapshot: LocalSoloSessionSnapshot
  tableTitle: string
  statusText: string
  toCall: number
  stackLead: string
  lastResult?: string
  handResult?: HandResultSummary
  presentationEvents: PresentationEvent[]
  historyOpen: boolean
  setHistoryOpen: (open: boolean) => void
  tableLayout: TableWindowLayout
  setTableLayout: (layout: TableWindowLayout) => void
  changeSetup: () => void
  startNext: () => void
  rematchSameSeed: () => void
  rematchRandomSeed: () => void
  submit: (command: HumanCommand) => void
  amounts: Record<string, number>
  setAmounts: Dispatch<SetStateAction<Record<string, number>>>
  heroSeat?: PublicSeatView
  opponentSeats: PublicSeatView[]
  pendingSeat?: PublicSeatView
  canStartNextHand: boolean
}

export function PokerClientShell({
  scene,
  snapshot,
  tableTitle,
  statusText,
  toCall,
  stackLead,
  lastResult,
  handResult,
  presentationEvents,
  historyOpen,
  setHistoryOpen,
  tableLayout,
  setTableLayout,
  changeSetup,
  startNext,
  rematchSameSeed,
  rematchRandomSeed,
  submit,
  amounts,
  setAmounts,
  heroSeat,
  opponentSeats,
  pendingSeat,
  canStartNextHand,
}: PokerClientShellProps) {
  return (
    <main className="poker-client-shell">
      <TableUtilityBar
        snapshot={snapshot}
        tableTitle={tableTitle}
        statusText={statusText}
        toCall={toCall}
        stackLead={stackLead}
        tableLayout={tableLayout}
        setTableLayout={setTableLayout}
        changeSetup={changeSetup}
      />
      <section className={`table-window-grid layout-${tableLayout}`} aria-label="Table windows">
        <section className="active-table-pane" aria-label="Active table pane">
          <PokerTableSurface
            snapshot={snapshot}
            heroSeat={heroSeat}
            opponentSeats={opponentSeats}
            pendingSeat={pendingSeat}
            handResult={handResult}
            scene={scene}
          />
          <ActionDock
            scene={scene}
            snapshot={snapshot}
            pendingSeat={pendingSeat}
            handResult={handResult}
            lastResult={lastResult}
            presentationEvents={presentationEvents}
            amounts={amounts}
            setAmounts={setAmounts}
            submit={submit}
            startNext={startNext}
            canStartNextHand={canStartNextHand}
          />
          {scene === 'matchResult' && snapshot.summary && (
            <div className="table-overlay">
              <SessionResult
                summary={snapshot.summary}
                rematchSameSeed={rematchSameSeed}
                rematchRandomSeed={rematchRandomSeed}
                changeSetup={changeSetup}
              />
            </div>
          )}
        </section>
        {Array.from({ length: Number(tableLayout) - 1 }).map((_, index) => (
          <InactiveTableSlot key={index} slotNumber={index + 2} />
        ))}
      </section>
      <HandHistoryDrawer
        events={snapshot.heroView.events}
        presentationEvents={presentationEvents}
        open={historyOpen}
        setOpen={setHistoryOpen}
      />
    </main>
  )
}

function TableUtilityBar({
  snapshot,
  tableTitle,
  statusText,
  toCall,
  stackLead,
  tableLayout,
  setTableLayout,
  changeSetup,
}: {
  snapshot: LocalSoloSessionSnapshot
  tableTitle: string
  statusText: string
  toCall: number
  stackLead: string
  tableLayout: TableWindowLayout
  setTableLayout: (layout: TableWindowLayout) => void
  changeSetup: () => void
}) {
  return (
    <header className="table-utility-bar" aria-label="Table utility bar">
      <div className="utility-brand">
        <span>ParaPoker Play Money</span>
        <strong>{tableTitle}</strong>
      </div>
      <dl className="utility-metrics">
        <Metric label="Hand" value={snapshot.publicView.handNumber} />
        <Metric label="Blinds" value={`${snapshot.config.smallBlind}/${snapshot.config.bigBlind}`} />
        <Metric label="To call" value={formatChips(toCall)} />
        <Metric label="Lead" value={stackLead} />
      </dl>
      <div className="utility-status">
        <span>{statusText}</span>
        <details>
          <summary>Details</summary>
          <p>Seed {String(snapshot.seed)}</p>
          <p>{snapshot.blueprint.visibility}</p>
        </details>
      </div>
      <label className="layout-picker">
        <span>Layout</span>
        <select
          aria-label="Table layout"
          value={tableLayout}
          onChange={(event) => setTableLayout(event.target.value as TableWindowLayout)}
        >
          <option value="1">1 table</option>
          <option value="2">2 tables</option>
          <option value="4">4 tables</option>
        </select>
      </label>
      <button type="button" onClick={changeSetup}>
        Change setup
      </button>
    </header>
  )
}

function PokerTableSurface({
  snapshot,
  heroSeat,
  opponentSeats,
  pendingSeat,
  handResult,
  scene,
}: {
  snapshot: LocalSoloSessionSnapshot
  heroSeat?: PublicSeatView
  opponentSeats: PublicSeatView[]
  pendingSeat?: PublicSeatView
  handResult?: HandResultSummary
  scene: SoloScene
}) {
  const winnerSeatIds = new Set(handResult?.winners.map((winner) => seatIdByName(snapshot.publicView.seats, winner.name)) ?? [])

  return (
    <section
      className={`poker-table-surface ${snapshot.mode === 'six-max' ? 'six-max-layout' : 'heads-up-layout'}`}
      aria-label="Poker table"
    >
      <div className="felt-oval" aria-hidden="true" />
      {opponentSeats.map((seat, index) => (
        <CompactSeatPod
          key={seat.id}
          seat={seat}
          npcDefinitionId={snapshot.blueprint.seats.find((entry) => entry.seatId === seat.id)?.npcDefinitionId}
          cards={seat.revealedCards}
          hiddenCards={!seat.revealedCards}
          label="Opponent seat"
          anchor={`opponent-${index + 1}`}
          active={pendingSeat?.id === seat.id}
          winner={winnerSeatIds.has(seat.id)}
        />
      ))}
      <CommunityBoard snapshot={snapshot} />
      {heroSeat && (
        <CompactSeatPod
          seat={heroSeat}
          cards={snapshot.heroView.holeCards}
          label="Hero seat"
          anchor="hero"
          active={pendingSeat?.id === heroSeat.id}
          winner={winnerSeatIds.has(heroSeat.id)}
          hero
        />
      )}
      {(scene === 'betweenHand' || scene === 'matchResult') && handResult && (
        <HandResultOverlay result={handResult} />
      )}
    </section>
  )
}

function InactiveTableSlot({ slotNumber }: { slotNumber: number }) {
  return (
    <section className="inactive-table-slot" aria-label={`Inactive table slot ${slotNumber}`}>
      <div className="inactive-table-oval" />
      <strong>Table {slotNumber}</strong>
      <span>Available when multi-table sessions are enabled</span>
    </section>
  )
}

function CommunityBoard({ snapshot }: { snapshot: LocalSoloSessionSnapshot }) {
  return (
    <div className="community-board" aria-label="Community board">
      <PotDisplay amount={snapshot.publicView.pot} street={snapshot.publicView.street ?? snapshot.publicView.status} />
      <div className="community" aria-label="Community cards">
        {Array.from({ length: 5 }).map((_, index) => (
          <PlayingCard key={index} card={snapshot.publicView.communityCards[index]} placeholder="Board" />
        ))}
      </div>
    </div>
  )
}

function PotDisplay({ amount, street }: { amount: number; street: string }) {
  return (
    <div className="pot-display">
      <strong>Pot {formatChips(amount)}</strong>
      <span>{titleCase(street)}</span>
    </div>
  )
}

function ActionDock({
  scene,
  snapshot,
  pendingSeat,
  handResult,
  lastResult,
  presentationEvents,
  amounts,
  setAmounts,
  submit,
  startNext,
  canStartNextHand,
}: {
  scene: SoloScene
  snapshot: LocalSoloSessionSnapshot
  pendingSeat?: PublicSeatView
  handResult?: HandResultSummary
  lastResult?: string
  presentationEvents: PresentationEvent[]
  amounts: Record<string, number>
  setAmounts: Dispatch<SetStateAction<Record<string, number>>>
  submit: (command: HumanCommand) => void
  startNext: () => void
  canStartNextHand: boolean
}) {
  return (
    <section className="action-dock" aria-label="Player actions">
      <div className="dock-status">
        <strong>{scene === 'betweenHand' ? 'Hand result' : 'Actions'}</strong>
        <span>{handResult?.label ?? lastResult ?? (pendingSeat ? `${pendingSeat.name} is next` : 'Resolving hand')}</span>
      </div>
      <PresentationQueue events={presentationEvents} />
      <div className="dock-actions">
        {snapshot.heroView.legalActions.length === 0 && !canStartNextHand && scene !== 'matchResult' && (
          <span className="muted">Waiting for the table authority.</span>
        )}
        {scene === 'playing' && snapshot.heroView.legalActions.map((action) => (
          <ActionControl
            key={action.type}
            action={action}
            amount={amounts[action.type]}
            setAmount={(amount) => setAmounts((current) => ({ ...current, [action.type]: amount }))}
            submit={submit}
          />
        ))}
        {scene === 'betweenHand' && (
          <button type="button" className="primary" onClick={startNext}>
            Next hand
          </button>
        )}
      </div>
      {snapshot.lastError && <p className="error">{snapshot.lastError}</p>}
    </section>
  )
}

function HandHistoryDrawer({
  events,
  presentationEvents,
  open,
  setOpen,
}: {
  events: LocalSinglePlayerSnapshot['heroView']['events']
  presentationEvents: PresentationEvent[]
  open: boolean
  setOpen: (open: boolean) => void
}) {
  return (
    <aside className={`history-drawer ${open ? 'open' : ''}`} aria-label="Hand history">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? 'Hide history' : `History (${events.length})`}
      </button>
      {open && (
        <div className="history-drawer-panel">
          <div className="section-heading">
            <h2>Hand history</h2>
            <span>{events.length} events</span>
          </div>
          <PresentationQueue events={presentationEvents} />
          <ol>
            {events.slice(-24).map((event) => (
              <li key={event.eventId}>{describeEvent(event)}</li>
            ))}
          </ol>
        </div>
      )}
    </aside>
  )
}

function PresentationQueue({ events }: { events: PresentationEvent[] }) {
  return (
    <div className="presentation-queue" aria-label="Table flow">
      <div className="queue-heading">
        <strong>Table flow</strong>
        <span>{events.length ? 'Latest verified events' : 'Waiting for action'}</span>
      </div>
      {events.length > 0 ? (
        <ol>
          {events.map((event) => (
            <li key={event.id}>{event.text}</li>
          ))}
        </ol>
      ) : (
        <p className="muted">The table authority will publish the next update here.</p>
      )}
    </div>
  )
}

function SessionResult({
  summary,
  rematchSameSeed,
  rematchRandomSeed,
  changeSetup,
}: {
  summary: NonNullable<LocalSoloSessionSnapshot['summary']>
  rematchSameSeed: () => void
  rematchRandomSeed: () => void
  changeSetup: () => void
}) {
  return (
    <section className="session-result" aria-label="Session result">
      <div className="controls-header">
        <div>
          <h2>Session result</h2>
          <p>{summary.winnerName ?? summary.winnerSeatId ?? 'No winner'} wins</p>
        </div>
        <span className="round-pill">{summary.mode}</span>
      </div>
      <dl className="result-grid">
        <Metric label="Hands" value={summary.handsPlayed} />
        <Metric label="Seed" value={String(summary.seed)} />
      </dl>
      <div className="stats-list" aria-label="Per-seat stats">
        {summary.stats.map((stat) => (
          <div key={stat.seatId}>
            <strong>{stat.seatId}</strong>
            <span>
              {stat.actions} actions, {stat.potsWon} pots, {stat.chipsAwarded} awarded
            </span>
            <span>Stack {summary.finalStacks[stat.seatId] ?? 0}</span>
          </div>
        ))}
      </div>
      <div className="result-actions">
        <button type="button" className="primary" onClick={rematchSameSeed}>
          Rematch same seed
        </button>
        <button type="button" onClick={rematchRandomSeed}>
          New random match
        </button>
        <button type="button" onClick={changeSetup}>
          Change setup
        </button>
      </div>
    </section>
  )
}

function HandResultOverlay({ result }: { result: HandResultSummary }) {
  return (
    <div className="hand-result-overlay" aria-label="Latest hand result">
      <strong>{result.label}</strong>
      <span>
        {result.winners
          .map((winner) => `${winner.name} wins ${winner.amount}${winner.handName ? ` with ${winner.handName}` : ''}`)
          .join(', ')}
      </span>
    </div>
  )
}

function CompactSeatPod({
  seat,
  cards,
  hiddenCards = false,
  label,
  active = false,
  npcDefinitionId,
  anchor,
  hero = false,
  winner = false,
}: {
  seat: PublicSeatView
  cards?: PublicSeatView['revealedCards']
  hiddenCards?: boolean
  label: string
  active?: boolean
  npcDefinitionId?: string
  anchor: string
  hero?: boolean
  winner?: boolean
}) {
  const presentation = seat.kind === 'npc'
    ? npcDefinitionId
      ? localNpcPresentationForDefinition(seat.id, npcDefinitionId)
      : localNpcPresentation(seat.id)
    : undefined
  const seatDescriptor = seat.kind === 'human'
    ? 'Local player'
    : presentation
      ? `${presentation.archetype} - ${titleCase(presentation.difficulty)}`
      : 'NPC opponent'
  const className = [
    'seat-pod',
    anchor,
    `status-${seat.status}`,
    active ? 'acting' : '',
    hero ? 'hero-seat' : '',
    winner ? 'winner-seat' : '',
  ].filter(Boolean).join(' ')

  return (
    <div className={className} aria-label={label} title={seatDescriptor}>
      <div className="seat-meta">
        <div>
          <strong>{seat.name}</strong>
          <span className="seat-role">{seat.kind === 'human' ? 'Hero' : 'NPC'}</span>
        </div>
        <span>{formatChips(seat.stack)}</span>
      </div>
      <div className="badges">
        {seat.position ? (
          <span>{seat.position}</span>
        ) : (
          <>
            {seat.isDealer && <span>Button</span>}
            {seat.isSmallBlind && <span>SB</span>}
            {seat.isBigBlind && <span>BB</span>}
          </>
        )}
        <span>{titleCase(seat.status)}</span>
        {active && <span>Acting</span>}
        {winner && <span>Winner</span>}
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
      {seat.streetContribution > 0 && (
        <div className="street-bet-marker" aria-label={`${seat.name} street contribution`}>
          {formatChips(seat.streetContribution)}
        </div>
      )}
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
    const minAmount = action.min
    const maxAmount = action.max
    const selectedAmount = amount ?? minAmount
    const actionName = titleCase(action.type)
    const step = 1

    function setClampedAmount(nextAmount: number) {
      setAmount(clampAmount(nextAmount, minAmount, maxAmount))
    }

    function adjustWithWheel(event: WheelEvent<HTMLInputElement>) {
      event.preventDefault()
      const direction = event.deltaY < 0 ? 1 : -1
      setClampedAmount(selectedAmount + direction * step)
    }

    return (
      <label className="amount-control">
        <span>{actionName}</span>
        <input
          className="amount-slider"
          type="range"
          min={minAmount}
          max={maxAmount}
          step={step}
          aria-label={`${actionName} amount slider`}
          value={selectedAmount}
          onChange={(event) => setClampedAmount(Number(event.target.value))}
          onWheel={adjustWithWheel}
        />
        <input
          className="amount-entry"
          type="number"
          min={minAmount}
          max={maxAmount}
          step={step}
          aria-label={`${actionName} amount entry`}
          value={selectedAmount}
          onChange={(event) => setClampedAmount(Number(event.target.value))}
          onWheel={adjustWithWheel}
        />
        <button type="button" onClick={() => submit({ type: action.type, amount: selectedAmount })}>
          {actionName} {formatChips(selectedAmount)}
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

function seatIdByName(seats: PublicSeatView[], name: string): string {
  return seats.find((seat) => seat.name === name)?.id ?? name
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

function clampAmount(amount: number, min: number, max: number): number {
  if (!Number.isFinite(amount)) {
    return min
  }
  return Math.min(max, Math.max(min, Math.round(amount)))
}
