import { useMemo, useRef, useState, type Dispatch, type SetStateAction, type WheelEvent } from 'react'
import { cardToString, type Card, type HandHistoryEvent, type LegalAction, type PublicSeatView } from '../poker-engine'
import { localNpcPresentation, localNpcPresentationForDefinition } from '../npc/roster'
import {
  createRandomLocalSeed,
  defaultLocalSoloSessionConfig,
  LocalSoloSession,
  type LocalSoloSessionConfig,
  type LocalSoloSessionSnapshot,
} from '../table-controllers/local-single-player/LocalSoloSession'
import type { LocalSinglePlayerSnapshot } from '../table-controllers/local-single-player/LocalSinglePlayerController'

type SoloScene = 'setup' | 'playing' | 'betweenHand' | 'matchResult'
type SeedMode = 'form' | 'same' | 'random'
interface HandResultSummary {
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
interface PresentationEvent {
  id: string
  text: string
}

export function PokerTable() {
  const sessionRef = useRef<LocalSoloSession | null>(null)
  const [setup, setSetup] = useState<LocalSoloSessionConfig>(defaultLocalSoloSessionConfig())
  const [useRandomSeed, setUseRandomSeed] = useState(false)
  const [snapshot, setSnapshot] = useState<LocalSoloSessionSnapshot | null>(null)
  const [scene, setScene] = useState<SoloScene>('setup')
  const [setupError, setSetupError] = useState('')
  const [amounts, setAmounts] = useState<Record<string, number>>({})
  const [presentationEvents, setPresentationEvents] = useState<PresentationEvent[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)

  const heroSeat = snapshot?.heroView.seats.find((seat) => seat.id === snapshot.heroView.heroSeatId)
  const opponentSeats = snapshot?.heroView.seats.filter((seat) => seat.id !== snapshot.heroView.heroSeatId) ?? []
  const pendingSeat = snapshot?.publicView.seats.find((seat) => seat.id === snapshot.publicView.pendingSeatId)
  const canStartNextHand = snapshot?.canonicalStatus === 'waitingForHand'
  const matchWinner = snapshot?.publicView.status === 'complete'
    ? snapshot.publicView.seats.find((seat) => seat.stack > 0)
    : undefined
  const toCall = snapshot && heroSeat && snapshot.publicView.pendingSeatId === heroSeat.id
    ? Math.max(0, snapshot.publicView.currentBet - heroSeat.streetContribution)
    : 0
  const stackLead = snapshot ? getStackLead(snapshot.publicView.seats, snapshot.heroView.heroSeatId) : 'Even'
  const lastResult = snapshot ? getLastResultText(snapshot) : undefined
  const handResult = snapshot ? getHandResultSummary(snapshot) : undefined
  const tableTitle = snapshot?.mode === 'six-max' ? "Six-Max No-Limit Hold'em" : "Heads-Up No-Limit Hold'em"

  const statusText = useMemo(() => {
    if (!snapshot) {
      return 'Configure a local match'
    }
    if (matchWinner) {
      return `${matchWinner.name} wins the match`
    }
    if (snapshot.publicView.status === 'waitingForHand') {
      return 'Hand complete'
    }
    const pending = snapshot.publicView.seats.find((seat) => seat.id === snapshot.publicView.pendingSeatId)
    return pending ? `${pending.name} to act` : 'Resolving hand'
  }, [matchWinner, snapshot])

  async function startSession(config: LocalSoloSessionConfig, seedMode: SeedMode = 'form') {
    const shouldUseRandomSeed = seedMode === 'random' || (seedMode === 'form' && useRandomSeed)
    const validationError = validateSetup(config, shouldUseRandomSeed)
    if (validationError) {
      setSetupError(validationError)
      return
    }

    const nextConfig = {
      ...config,
      seed: shouldUseRandomSeed ? createRandomLocalSeed() : String(config.seed).trim(),
    }
    const session = await LocalSoloSession.create(nextConfig)
    const nextSnapshot = session.getSnapshot()
    sessionRef.current = session
    setSetup(nextConfig)
    setSetupError('')
    setAmounts({})
    applySnapshot(nextSnapshot, null)
  }

  async function submit(command: HumanCommand) {
    const session = sessionRef.current
    if (!session) {
      return
    }
    const previousSnapshot = snapshot
    const nextSnapshot = await session.submitHumanAction(command)
    applySnapshot(nextSnapshot, previousSnapshot)
  }

  async function startNext() {
    const session = sessionRef.current
    if (!session) {
      return
    }
    const previousSnapshot = snapshot
    setAmounts({})
    const nextSnapshot = await session.startNextHand()
    applySnapshot(nextSnapshot, previousSnapshot)
  }

  function updateSetup<TField extends keyof LocalSoloSessionConfig>(field: TField, value: LocalSoloSessionConfig[TField]) {
    setSetup((current) => ({ ...current, [field]: value }))
    setSetupError('')
  }

  function changeSetup() {
    const abandoningActiveMatch = snapshot?.publicView.status === 'handInProgress' || snapshot?.publicView.status === 'waitingForHand'
    if (abandoningActiveMatch && !snapshot.summary) {
      const confirmed = window.confirm('Abandon this local match and return to setup?')
      if (!confirmed) {
        return
      }
    }
    sessionRef.current = null
    setSnapshot(null)
    setAmounts({})
    setPresentationEvents([])
    setScene('setup')
  }

  function applySnapshot(nextSnapshot: LocalSoloSessionSnapshot, previousSnapshot: LocalSoloSessionSnapshot | null) {
    setSnapshot(nextSnapshot)
    setScene(sceneForSnapshot(nextSnapshot))
    setPresentationEvents(getPresentationEvents(nextSnapshot, previousSnapshot))
  }

  function rematchSameSeed() {
    const config = snapshot?.config ?? setup
    void startSession({ ...config, seed: snapshot?.seed ?? config.seed }, 'same')
  }

  function rematchRandomSeed() {
    const config = snapshot?.config ?? setup
    void startSession(config, 'random')
  }

  if (scene === 'setup' || !snapshot) {
    return (
      <main className="setup-shell">
        <section className="setup-card" aria-label="Local match setup">
          <p className="eyebrow">ParaPoker Play Money</p>
          <h1>Start a Local Solo Match</h1>
          <p className="setup-copy">Choose a heads-up or six-max freezeout before the table is created.</p>
          <SetupForm
            setup={setup}
            useRandomSeed={useRandomSeed}
            setupError={setupError}
            updateSetup={updateSetup}
            setUseRandomSeed={setUseRandomSeed}
            startMatch={() => void startSession(setup)}
          />
        </section>
      </main>
    )
  }

  return (
    <PokerClientShell
      scene={scene}
      snapshot={snapshot}
      tableTitle={tableTitle}
      statusText={statusText}
      toCall={toCall}
      stackLead={stackLead}
      lastResult={lastResult}
      handResult={handResult}
      presentationEvents={presentationEvents}
      historyOpen={historyOpen}
      setHistoryOpen={setHistoryOpen}
      changeSetup={changeSetup}
      startNext={() => void startNext()}
      rematchSameSeed={rematchSameSeed}
      rematchRandomSeed={rematchRandomSeed}
      submit={(command) => void submit(command)}
      amounts={amounts}
      setAmounts={setAmounts}
      heroSeat={heroSeat}
      opponentSeats={opponentSeats}
      pendingSeat={pendingSeat}
      canStartNextHand={canStartNextHand}
    />
  )
}

function PokerClientShell({
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
}: {
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
}) {
  return (
    <main className="poker-client-shell">
      <TableUtilityBar
        snapshot={snapshot}
        tableTitle={tableTitle}
        statusText={statusText}
        toCall={toCall}
        stackLead={stackLead}
        changeSetup={changeSetup}
      />
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
      <HandHistoryDrawer
        events={snapshot.heroView.events}
        presentationEvents={presentationEvents}
        open={historyOpen}
        setOpen={setHistoryOpen}
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
    </main>
  )
}

function TableUtilityBar({
  snapshot,
  tableTitle,
  statusText,
  toCall,
  stackLead,
  changeSetup,
}: {
  snapshot: LocalSoloSessionSnapshot
  tableTitle: string
  statusText: string
  toCall: number
  stackLead: string
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
        <select aria-label="Table layout" value="1" onChange={() => undefined}>
          <option value="1">1 table</option>
          <option value="2" disabled>2 tables planned</option>
          <option value="4" disabled>4 tables planned</option>
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

function SetupForm({
  setup,
  useRandomSeed,
  setupError,
  updateSetup,
  setUseRandomSeed,
  startMatch,
}: {
  setup: LocalSoloSessionConfig
  useRandomSeed: boolean
  setupError: string
  updateSetup: <TField extends keyof LocalSoloSessionConfig>(
    field: TField,
    value: LocalSoloSessionConfig[TField],
  ) => void
  setUseRandomSeed: (value: boolean) => void
  startMatch: () => void
}) {
  return (
    <>
      <div className="mode-switch" aria-label="Solo mode setup">
        <button
          type="button"
          className={setup.mode === 'heads-up' ? 'selected' : ''}
          aria-pressed={setup.mode === 'heads-up'}
          onClick={() => updateSetup('mode', 'heads-up')}
        >
          Heads-up
        </button>
        <button
          type="button"
          className={setup.mode === 'six-max' ? 'selected' : ''}
          aria-pressed={setup.mode === 'six-max'}
          onClick={() => updateSetup('mode', 'six-max')}
        >
          Six-max
        </button>
      </div>
      <div className="setup-grid">
        <NumberField label="Stack" value={setup.startingStack} onChange={(value) => updateSetup('startingStack', value)} />
        <NumberField label="SB" value={setup.smallBlind} onChange={(value) => updateSetup('smallBlind', value)} />
        <NumberField label="BB" value={setup.bigBlind} onChange={(value) => updateSetup('bigBlind', value)} />
        <label className="seed-field">
          <span>Seed</span>
          <input
            value={String(setup.seed)}
            disabled={useRandomSeed}
            aria-label="Seed"
            onChange={(event) => updateSetup('seed', event.target.value)}
          />
        </label>
        <label className="toggle-field">
          <input
            type="checkbox"
            checked={useRandomSeed}
            onChange={(event) => setUseRandomSeed(event.target.checked)}
          />
          <span>Random local seed</span>
        </label>
        <button type="button" className="primary" onClick={startMatch}>
          Start Match
        </button>
      </div>
      {setupError && <p className="error" role="alert">{setupError}</p>}
    </>
  )
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="number-field">
      <span>{label}</span>
      <input
        type="number"
        min={1}
        step={1}
        aria-label={label}
        value={value}
        onChange={(event) => onChange(Math.round(Number(event.target.value) || 0))}
      />
    </label>
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
      <div className="contribution" aria-label={`${seat.name} street contribution`}>
        Bet {formatChips(seat.streetContribution)}
      </div>
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

function sceneForSnapshot(snapshot: LocalSoloSessionSnapshot): SoloScene {
  if (snapshot.summary || snapshot.publicView.status === 'complete') {
    return 'matchResult'
  }
  if (snapshot.canonicalStatus === 'waitingForHand') {
    return 'betweenHand'
  }
  return 'playing'
}

function validateSetup(config: LocalSoloSessionConfig, randomSeed: boolean): string {
  if (!Number.isInteger(config.startingStack) || config.startingStack <= 0) {
    return 'Starting stack must be a positive whole number.'
  }
  if (!Number.isInteger(config.smallBlind) || config.smallBlind <= 0) {
    return 'Small blind must be a positive whole number.'
  }
  if (!Number.isInteger(config.bigBlind) || config.bigBlind <= 0) {
    return 'Big blind must be a positive whole number.'
  }
  if (config.bigBlind < config.smallBlind) {
    return 'Big blind must be at least the small blind.'
  }
  if (config.startingStack < config.bigBlind) {
    return 'Starting stack must be at least the big blind.'
  }
  if (!randomSeed && String(config.seed).trim().length === 0) {
    return 'Seed is required unless random local seed is enabled.'
  }
  return ''
}

function getStackLead(seats: PublicSeatView[], heroSeatId: string): string {
  const hero = seats.find((seat) => seat.id === heroSeatId)
  if (!hero || seats.length < 2) {
    return 'Even'
  }
  const orderedByStack = [...seats].sort((left, right) => right.stack - left.stack)
  const leader = orderedByStack[0]
  const comparisonSeat = leader.id === heroSeatId ? orderedByStack[1] : leader
  if (!comparisonSeat) {
    return 'Even'
  }
  const difference = hero.stack - comparisonSeat.stack
  if (difference === 0) {
    return 'Even'
  }
  return difference > 0 ? `You +${difference}` : `${comparisonSeat.name} +${Math.abs(difference)}`
}

function seatIdByName(seats: PublicSeatView[], name: string): string {
  return seats.find((seat) => seat.name === name)?.id ?? name
}

function getLastResultText(snapshot: LocalSinglePlayerSnapshot): string | undefined {
  const awarded = [...snapshot.heroView.events].reverse().find((event) => event.type === 'potAwarded')
  if (!awarded || snapshot.publicView.status === 'handInProgress') {
    return undefined
  }
  return `Last pot: ${awarded.payload.winners.map((winner) => `${winner.seatId} won ${winner.amount}`).join(', ')}`
}

function getHandResultSummary(snapshot: LocalSinglePlayerSnapshot): HandResultSummary | undefined {
  const awarded = [...snapshot.heroView.events].reverse().find((event) => event.type === 'potAwarded')
  if (!awarded || snapshot.publicView.status === 'handInProgress') {
    return undefined
  }

  const showdown = [...snapshot.heroView.events].reverse().find((event) => event.type === 'showdown')
  const seatName = (seatId: string) => snapshot.publicView.seats.find((seat) => seat.id === seatId)?.name ?? seatId
  const winners = awarded.payload.winners.map((winner) => ({
    name: seatName(winner.seatId),
    amount: winner.amount,
    handName: winner.handName,
    cards: winner.cards,
  }))
  const revealed = showdown && showdown.handId === awarded.handId
    ? Object.entries(showdown.payload.revealedCards).map(([seatId, cards]) => ({
        name: seatName(seatId),
        cards,
      }))
    : []

  return {
    label: revealed.length > 0 ? 'Showdown result' : 'Pot awarded',
    winners,
    revealed,
  }
}

function getPresentationEvents(
  snapshot: LocalSinglePlayerSnapshot,
  previousSnapshot: LocalSinglePlayerSnapshot | null,
): PresentationEvent[] {
  const previousEventIds = new Set(previousSnapshot?.heroView.events.map((event) => event.eventId) ?? [])
  const events = snapshot.heroView.events.filter((event) => !previousEventIds.has(event.eventId))
  const visibleEvents = events.length > 0 ? events : snapshot.heroView.events.slice(-4)

  return visibleEvents
    .map((event) => ({
      id: event.eventId,
      text: describePresentationEvent(event, snapshot),
    }))
    .slice(-5)
}

function describePresentationEvent(
  event: HandHistoryEvent,
  snapshot: LocalSinglePlayerSnapshot,
): string {
  const seatName = (seatId: string) => snapshot.publicView.seats.find((seat) => seat.id === seatId)?.name ?? seatId
  switch (event.type) {
    case 'handStarted':
      return `Hand ${event.handId} begins; button is ${seatName(event.payload.dealerSeatId)}.`
    case 'blindPosted':
      return `${seatName(event.payload.seatId)} posts ${event.payload.blind} blind ${event.payload.amount}.`
    case 'holeCardsDealt':
      return `${seatName(event.payload.seatId)} receives hole cards.`
    case 'actionApplied':
      return `${seatName(event.payload.seatId)} ${event.payload.action}${event.payload.amount ? ` ${event.payload.amount}` : ''}.`
    case 'streetAdvanced':
      return `${titleCase(event.payload.street)} dealt.`
    case 'showdown':
      return `Showdown: ${Object.keys(event.payload.revealedCards).map(seatName).join(', ')} reveal.`
    case 'potAwarded':
      return `Pot awarded: ${event.payload.winners
        .map((winner) => `${seatName(winner.seatId)} wins ${winner.amount}`)
        .join(', ')}.`
    case 'matchComplete':
      return `${seatName(event.payload.winnerSeatId)} wins the match.`
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
