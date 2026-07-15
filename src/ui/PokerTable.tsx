import { useEffect, useMemo, useRef, useState } from 'react'
import type { HandHistoryEvent, PublicSeatView } from '../poker-engine'
import {
  PokerClientShell,
  type HandResultSummary,
  type HumanCommand,
  type PresentationEvent,
  type TableWindowLayout,
} from './PokerClientShell'
import {
  createRandomLocalSeed,
  defaultLocalSoloSessionConfig,
  LocalSoloSession,
  type LocalSoloSessionConfig,
  type LocalSoloSessionSnapshot,
} from '../table-controllers/local-single-player/LocalSoloSession'
import type { LocalSinglePlayerSnapshot } from '../table-controllers/local-single-player/LocalSinglePlayerController'
import { IndexedDbHandHistoryArchiveStore } from '../persistence'
import type { CompletedSessionPackage } from '../exports/completedSessionPackage'
import { completedSessionPackageToPokerNowCsv } from '../exports/pokerNowCsv'
import type { LobbyTableInstance } from '../game-config/gameBlueprintStore'

type SoloScene = 'setup' | 'playing' | 'betweenHand' | 'matchResult'
type SeedMode = 'form' | 'same' | 'random'

export function PokerTable({
  joinedTable = null,
  openAdmin = () => {},
}: {
  joinedTable?: LobbyTableInstance | null
  openAdmin?: () => void
}) {
  const sessionRef = useRef<LocalSoloSession | null>(null)
  const archiveStoreRef = useRef(new IndexedDbHandHistoryArchiveStore())
  const startedLobbyTableIdRef = useRef<string | null>(null)
  const [setup, setSetup] = useState<LocalSoloSessionConfig>(defaultLocalSoloSessionConfig())
  const [useRandomSeed, setUseRandomSeed] = useState(false)
  const [snapshot, setSnapshot] = useState<LocalSoloSessionSnapshot | null>(null)
  const [scene, setScene] = useState<SoloScene>('setup')
  const [setupError, setSetupError] = useState('')
  const [amounts, setAmounts] = useState<Record<string, number>>({})
  const [presentationEvents, setPresentationEvents] = useState<PresentationEvent[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [tableLayout, setTableLayout] = useState<TableWindowLayout>('1')
  const [completedPackage, setCompletedPackage] = useState<CompletedSessionPackage | null>(null)

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

  useEffect(() => {
    if (!joinedTable || startedLobbyTableIdRef.current === joinedTable.tableId) {
      return
    }
    startedLobbyTableIdRef.current = joinedTable.tableId
    async function startJoinedTable(table: LobbyTableInstance) {
      const nextConfig = configForLobbyTable(table)
      const session = await LocalSoloSession.create(nextConfig, { archiveStore: archiveStoreRef.current })
      const nextSnapshot = session.getSnapshot()
      sessionRef.current = session
      setSetup(nextConfig)
      setUseRandomSeed(false)
      setSetupError('')
      setAmounts({})
      setCompletedPackage(null)
      setSnapshot(nextSnapshot)
      setScene(sceneForSnapshot(nextSnapshot))
      setPresentationEvents(getPresentationEvents(nextSnapshot, null))
    }
    void startJoinedTable(joinedTable)
  }, [joinedTable])

  useEffect(() => {
    let cancelled = false
    async function loadCompletedPackage() {
      const session = sessionRef.current
      if (!session || !snapshot?.summary) {
        setCompletedPackage(null)
        return
      }
      const exported = await session.exportCompletedSessionPackage()
      if (!cancelled) {
        setCompletedPackage(exported)
      }
    }
    void loadCompletedPackage()
    return () => {
      cancelled = true
    }
  }, [snapshot?.matchId, snapshot?.summary])

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
    const session = await LocalSoloSession.create(nextConfig, { archiveStore: archiveStoreRef.current })
    const nextSnapshot = session.getSnapshot()
    sessionRef.current = session
    setSetup(nextConfig)
    setSetupError('')
    setAmounts({})
    setCompletedPackage(null)
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
    setCompletedPackage(null)
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
          {joinedTable && (
            <p className="setup-copy">
              Joined lobby table {joinedTable.tableId}; preparing pinned blueprint v{joinedTable.blueprintVersion}.
            </p>
          )}
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
      tableLayout={tableLayout}
      setTableLayout={setTableLayout}
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
      archiveStatus={snapshot.archive?.status ?? 'active'}
      packageChecksum={completedPackage?.integrity.checksum ?? snapshot.archive?.packageChecksum}
      canDownloadHandHistory={Boolean(completedPackage)}
      downloadHandHistory={() => {
        if (completedPackage) {
          downloadCompletedPackage(completedPackage)
        }
      }}
      viewHandHistories={openAdmin}
    />
  )
}

function configForLobbyTable(table: LobbyTableInstance): LocalSoloSessionConfig {
  return {
    mode: table.blueprint.mode,
    startingStack: table.blueprint.startingStack,
    smallBlind: table.blueprint.smallBlind,
    bigBlind: table.blueprint.bigBlind,
    seed: table.blueprint.seed,
    visibility: table.blueprint.visibility,
    blueprint: table.blueprint,
    npcLineup: table.blueprint.seats
      .filter((seat) => seat.kind === 'npc' && seat.npcDefinitionId)
      .map((seat) => ({ seatId: seat.seatId, npcDefinitionId: seat.npcDefinitionId ?? '' })),
  }
}

function downloadCompletedPackage(completedPackage: CompletedSessionPackage) {
  const csv = completedSessionPackageToPokerNowCsv(completedPackage)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `parapoker-${completedPackage.source.sourceMatchId}-hand-history.csv`
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
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

function titleCase(value: string): string {
  return value
    .split(/[-\s]/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}
