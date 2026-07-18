import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { HandHistoryEvent, PublicSeatView } from '../poker-engine'
import {
  PokerClientShell,
  type HandResultSummary,
  type HumanCommand,
  type PresentationEvent,
  type SecondaryTableWindow,
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
import { completedSessionPackageToParaPokerSiteCsv } from '../exports/paraPokerSiteCsv'
import {
  IndexedDbGameBlueprintStore,
  type LobbyTableInstance,
} from '../game-config/gameBlueprintStore'
import { assignHumanPlayerIdentity, type HumanPlayerIdentity } from '../game-config/gameBlueprint'
import type { ClientPlayerIdentity } from '../integrations/supabase/identityRepository'
import { IndexedDbNpcRegistryStore } from '../npc/npcRegistry'

type SoloScene = 'setup' | 'playing' | 'betweenHand' | 'matchResult'
type SeedMode = 'form' | 'same' | 'random'

export function PokerTable({
  joinedTable = null,
  joinedTables = [],
  playerIdentity = null,
  identityResolved = true,
  openAdmin = () => {},
  onLeaveTable = () => {},
  onActivateTable = () => {},
}: {
  joinedTable?: LobbyTableInstance | null
  joinedTables?: LobbyTableInstance[]
  playerIdentity?: ClientPlayerIdentity | null
  identityResolved?: boolean
  openAdmin?: () => void
  onLeaveTable?: (tableId: string) => void
  onActivateTable?: (tableId: string) => void
}) {
  const sessionRef = useRef<LocalSoloSession | null>(null)
  const lobbySessionRefs = useRef(new Map<string, LocalSoloSession>())
  const archiveStoreRef = useRef(new IndexedDbHandHistoryArchiveStore())
  const blueprintStoreRef = useRef(new IndexedDbGameBlueprintStore())
  const npcRegistryRef = useRef(new IndexedDbNpcRegistryStore())
  const closedLobbyTableIdsRef = useRef(new Set<string>())
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
  const [lobbySnapshots, setLobbySnapshots] = useState<Record<string, LocalSoloSessionSnapshot>>({})

  const closeJoinedLobbyTable = useCallback(async (reason: string) => {
    if (!joinedTable || closedLobbyTableIdsRef.current.has(joinedTable.tableId)) {
      return
    }
    await blueprintStoreRef.current.closeLobbyTable(joinedTable.tableId, reason)
    closedLobbyTableIdsRef.current.add(joinedTable.tableId)
  }, [joinedTable])

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
  const secondaryTables = useMemo<SecondaryTableWindow[]>(() => {
    return joinedTables
      .filter((table) => table.tableId !== joinedTable?.tableId)
      .map((table) => {
        const tableSnapshot = lobbySnapshots[table.tableId]
        if (!tableSnapshot) {
          return undefined
        }
        return {
          tableId: table.tableId,
          title: tableSnapshot.mode === 'six-max' ? "Six-Max No-Limit Hold'em" : "Heads-Up No-Limit Hold'em",
          status: statusForSnapshot(tableSnapshot),
          snapshot: tableSnapshot,
          scene: sceneForSnapshot(tableSnapshot),
        }
      })
      .filter((table): table is SecondaryTableWindow => Boolean(table))
  }, [joinedTable?.tableId, joinedTables, lobbySnapshots])

  useEffect(() => {
    if (joinedTables.length === 0) {
      return
    }
    let cancelled = false
    async function ensureJoinedSessions() {
      if (!identityResolved) {
        return
      }
      const registry = await npcRegistryRef.current.snapshot()
      for (const table of joinedTables) {
        if (!lobbySessionRefs.current.has(table.tableId)) {
          const tableSession = await LocalSoloSession.create(configForLobbyTable(table, playerIdentity), {
            archiveStore: archiveStoreRef.current,
            npcDefinitions: registry.definitions,
            npcStrategyProfiles: registry.strategyProfiles,
          })
          await blueprintStoreRef.current.startLobbyTable(table.tableId)
          if (cancelled) {
            return
          }
          lobbySessionRefs.current.set(table.tableId, tableSession)
          setLobbySnapshots((current) => ({ ...current, [table.tableId]: tableSession.getSnapshot() }))
        }
      }
      const currentTable = joinedTable ?? joinedTables[0]
      const currentSession = lobbySessionRefs.current.get(currentTable.tableId)
      if (currentSession && startedLobbyTableIdRef.current !== currentTable.tableId) {
        startedLobbyTableIdRef.current = currentTable.tableId
        const nextConfig = configForLobbyTable(currentTable, playerIdentity)
        const nextSnapshot = currentSession.getSnapshot()
        sessionRef.current = currentSession
        setSetup(nextConfig)
        setUseRandomSeed(false)
        setSetupError('')
        setAmounts({})
        setCompletedPackage(null)
        setSnapshot(nextSnapshot)
        setScene(sceneForSnapshot(nextSnapshot))
        setPresentationEvents(getPresentationEvents(nextSnapshot, null))
      }
    }
    void ensureJoinedSessions()
    return () => {
      cancelled = true
    }
  }, [identityResolved, joinedTable, joinedTables, playerIdentity])

  useEffect(() => {
    const activeCount = joinedTables.length
    if (activeCount > 2) {
      setTableLayout('4')
    } else if (activeCount > 1) {
      setTableLayout('2')
    }
  }, [joinedTables.length])

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

  useEffect(() => {
    if (!joinedTable || !snapshot?.summary || closedLobbyTableIdsRef.current.has(joinedTable.tableId)) {
      return
    }
    void closeJoinedLobbyTable('match-complete')
  }, [closeJoinedLobbyTable, joinedTable, snapshot?.summary])

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
    if (!identityResolved) {
      setSetupError('Player identity is still loading.')
      return
    }
    const shouldUseRandomSeed = seedMode === 'random' || (seedMode === 'form' && useRandomSeed)
    const validationError = validateSetup(config, shouldUseRandomSeed)
    if (validationError) {
      setSetupError(validationError)
      return
    }

    const nextConfig = {
      ...configWithPlayerIdentity(config, playerIdentity),
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

  async function changeSetup() {
    const abandoningActiveMatch = snapshot?.publicView.status === 'handInProgress' || snapshot?.publicView.status === 'waitingForHand'
    if (abandoningActiveMatch && !snapshot.summary) {
      const confirmed = window.confirm('Concede this match and leave the table?')
      if (!confirmed) {
        return
      }
      await sessionRef.current?.concede()
      await closeJoinedLobbyTable('player-conceded')
    }
    if (joinedTable) {
      lobbySessionRefs.current.delete(joinedTable.tableId)
      setLobbySnapshots((current) => {
        const next = { ...current }
        delete next[joinedTable.tableId]
        return next
      })
      startedLobbyTableIdRef.current = null
      onLeaveTable(joinedTable.tableId)
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
    if (joinedTable) {
      setLobbySnapshots((current) => ({ ...current, [joinedTable.tableId]: nextSnapshot }))
    }
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
        <header className="setup-header">
          <p className="eyebrow">Create match</p>
          <h1>Start a Local Solo Match</h1>
          <p>Configure a play-money freezeout and preview the field before cards are dealt.</p>
        </header>
        <section className="setup-layout" aria-label="Local match setup">
          <div className="setup-card">
            <div className="setup-section-heading">
              <div>
                <span>Match configuration</span>
                <strong>{setup.mode === 'six-max' ? 'Six-max freezeout' : 'Heads-up freezeout'}</strong>
              </div>
              <p className="setup-copy" aria-label="Current player identity">
                {identityResolved ? (
                  <>Playing as <strong>{playerIdentity?.screenName ?? 'local guest'}</strong></>
                ) : 'Loading player identity...'}
              </p>
            </div>
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
          </div>
          <SetupPreview setup={setup} />
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
      changeSetup={() => void changeSetup()}
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
      secondaryTables={secondaryTables}
      onActivateTable={onActivateTable}
    />
  )
}

function configForLobbyTable(
  table: LobbyTableInstance,
  playerIdentity: ClientPlayerIdentity | null,
): LocalSoloSessionConfig {
  const humanPlayer = toHumanPlayerIdentity(playerIdentity)
  const blueprint = assignHumanPlayerIdentity(table.blueprint, humanPlayer)
  return {
    mode: blueprint.mode,
    startingStack: blueprint.startingStack,
    smallBlind: blueprint.smallBlind,
    bigBlind: blueprint.bigBlind,
    seed: table.resolvedSeed ?? blueprint.seed,
    visibility: blueprint.visibility,
    blueprint,
    humanPlayer,
    npcLineup: blueprint.seats
      .filter((seat) => seat.kind === 'npc' && seat.npcDefinitionId)
      .map((seat) => ({ seatId: seat.seatId, npcDefinitionId: seat.npcDefinitionId ?? '' })),
  }
}

function configWithPlayerIdentity(
  config: LocalSoloSessionConfig,
  playerIdentity: ClientPlayerIdentity | null,
): LocalSoloSessionConfig {
  const humanPlayer = toHumanPlayerIdentity(playerIdentity)
  return {
    ...config,
    humanPlayer,
    ...(config.blueprint ? { blueprint: assignHumanPlayerIdentity(config.blueprint, humanPlayer) } : {}),
  }
}

function toHumanPlayerIdentity(playerIdentity: ClientPlayerIdentity | null): HumanPlayerIdentity {
  return playerIdentity
    ? { playerId: playerIdentity.profileId, displayName: playerIdentity.screenName }
    : { playerId: 'local-human', displayName: 'You' }
}

function downloadCompletedPackage(completedPackage: CompletedSessionPackage) {
  const csv = completedSessionPackageToParaPokerSiteCsv(completedPackage)
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
      <div className="mode-switch" role="group" aria-label="Solo mode setup">
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
      </div>
      <details className="setup-advanced">
        <summary>Seed and reproducibility</summary>
        <div>
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
        </div>
      </details>
      <div className="setup-submit-row">
        <span>{setup.startingStack} chips - {setup.smallBlind}/{setup.bigBlind} blinds</span>
        <button type="button" className="primary" onClick={startMatch}>Start Match</button>
      </div>
      {setupError && <p className="error" role="alert">{setupError}</p>}
    </>
  )
}

function SetupPreview({ setup }: { setup: LocalSoloSessionConfig }) {
  const lineup = setup.mode === 'six-max'
    ? ['Maven', 'Quinn', 'Rook', 'Sol', 'Vega']
    : ['Maven']

  return (
    <aside className="setup-preview" aria-label="Match preview">
      <div className="setup-table-preview" aria-hidden="true">
        {lineup.map((name, index) => <span key={name} className={`preview-seat preview-seat-${index + 1}`}>{name}</span>)}
        <span className="preview-seat preview-hero">You</span>
        <div className="preview-board"><i /><i /><i /></div>
      </div>
      <div className="setup-preview-copy">
        <p className="eyebrow">Field preview</p>
        <h2>{setup.mode === 'six-max' ? 'Six seats. One winner.' : 'One opponent. One winner.'}</h2>
        <p>{setup.mode === 'six-max' ? 'A five-NPC lineup with independent strategy profiles.' : 'A direct heads-up test against Maven, the measured caller.'}</p>
      </div>
      <dl className="setup-preview-metrics">
        <PreviewMetric label="Format" value={setup.mode === 'six-max' ? '6-max' : 'Heads-up'} />
        <PreviewMetric label="Starting stack" value={setup.startingStack} />
        <PreviewMetric label="Blinds" value={`${setup.smallBlind}/${setup.bigBlind}`} />
      </dl>
      <div className="setup-roster">
        <span>Opponent roster</span>
        <strong>{lineup.join(' / ')}</strong>
      </div>
    </aside>
  )
}

function PreviewMetric({ label, value }: { label: string; value: string | number }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>
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

function statusForSnapshot(snapshot: LocalSoloSessionSnapshot): string {
  if (snapshot.summary || snapshot.publicView.status === 'complete') {
    return 'Match complete'
  }
  if (snapshot.canonicalStatus === 'waitingForHand') {
    return 'Hand complete'
  }
  const pending = snapshot.publicView.seats.find((seat) => seat.id === snapshot.publicView.pendingSeatId)
  return pending ? `${pending.name} to act` : 'Resolving hand'
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
  return difference > 0 ? `${hero.name} +${difference}` : `${comparisonSeat.name} +${Math.abs(difference)}`
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
      return `${seatName(event.payload.seatId)} ${presentationAction(event.payload.action, seatName(event.payload.seatId))}${event.payload.amount ? ` ${event.payload.amount}` : ''}.`
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

function presentationAction(action: string, playerName: string): string {
  if (playerName === 'You') {
    return action
  }
  const actions: Record<string, string> = {
    fold: 'folds',
    check: 'checks',
    call: 'calls',
    bet: 'bets',
    raise: 'raises',
    allIn: 'goes all-in',
  }
  return actions[action] ?? action
}

function titleCase(value: string): string {
  return value
    .split(/[-\s]/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}
