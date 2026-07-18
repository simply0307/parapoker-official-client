import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createGameBlueprint,
  defaultNpcLineup,
  gameBlueprintToControllerConfig,
  type GameBlueprintMode,
  type GameSeedPolicy,
  type GameVisibility,
} from '../game-config/gameBlueprint'
import {
  IndexedDbGameBlueprintStore,
  type GameBlueprintRecord,
  type LobbyTableInstance,
} from '../game-config/gameBlueprintStore'
import type { NpcDefinition, NpcSeatAssignment, NpcStrategyProfile } from '../npc/config'
import { IndexedDbNpcRegistryStore } from '../npc/npcRegistry'
import { LOCAL_NPC_DEFINITIONS, LOCAL_NPC_STRATEGY_PROFILES } from '../npc/roster'
import {
  deriveNpcStrategyEvidence,
  type NpcObservedStrategyEvidence,
} from '../npc/npcObservedStrategyStats'
import {
  IndexedDbHandHistoryArchiveStore,
  type ArchivedSessionDetail,
  type ArchivedSessionRecord,
  type HandHistoryArchiveStatus,
} from '../persistence'
import { completedSessionPackageToParaPokerSiteCsv } from '../exports/paraPokerSiteCsv'
import { AdminStrategyWorkspace } from './AdminStrategyWorkspace'
import type { NpcDecisionTrace } from '../npc/npcDecisionTrace'

interface AdminGameDraft {
  mode: GameBlueprintMode
  visibility: GameVisibility
  startingStack: number
  smallBlind: number
  bigBlind: number
  seedPolicy: GameSeedPolicy
  seed: string
  npcLineup: NpcSeatAssignment[]
}

type ImportWorkflowStatus = Extract<HandHistoryArchiveStatus, 'export-ready' | 'csv-generated' | 'submitted' | 'imported' | 'import-failed'>
type LobbyTableFilter = 'all' | 'active' | 'closed' | 'cancelled'

export function AdminPortal() {
  const archiveStoreRef = useRef(new IndexedDbHandHistoryArchiveStore())
  const npcRegistryRef = useRef(new IndexedDbNpcRegistryStore())
  const blueprintStoreRef = useRef(new IndexedDbGameBlueprintStore())
  const [npcDefinitions, setNpcDefinitions] = useState<NpcDefinition[]>(LOCAL_NPC_DEFINITIONS)
  const [strategyProfiles, setStrategyProfiles] = useState<NpcStrategyProfile[]>(LOCAL_NPC_STRATEGY_PROFILES)
  const [blueprintRecords, setBlueprintRecords] = useState<GameBlueprintRecord[]>([])
  const [lobbyTables, setLobbyTables] = useState<LobbyTableInstance[]>([])
  const [gameDraft, setGameDraft] = useState<AdminGameDraft>(() => ({
    mode: 'heads-up',
    visibility: 'private',
    startingStack: 200,
    smallBlind: 1,
    bigBlind: 2,
    seedPolicy: 'random',
    seed: '',
    npcLineup: defaultNpcLineup('heads-up'),
  }))
  const [archivedSessions, setArchivedSessions] = useState<ArchivedSessionRecord[]>([])
  const [selectedArchive, setSelectedArchive] = useState<ArchivedSessionDetail | null>(null)
  const [lobbyTableFilter, setLobbyTableFilter] = useState<LobbyTableFilter>('active')
  const [showStrategyWorkspace, setShowStrategyWorkspace] = useState(false)
  const [strategyEvidence, setStrategyEvidence] = useState<NpcObservedStrategyEvidence[]>([])
  const [operatorMessage, setOperatorMessage] = useState('Operator console is local-only; production access must be server-authorized.')

  const activeNpcDefinitions = npcDefinitions.filter((npc) => npc.status === 'active')
  const resolvedBlueprint = useMemo(
    () =>
      createGameBlueprint({
        mode: gameDraft.mode,
        visibility: gameDraft.visibility,
        startingStack: gameDraft.startingStack,
        smallBlind: gameDraft.smallBlind,
        bigBlind: gameDraft.bigBlind,
        seedPolicy: gameDraft.seedPolicy,
        seed: gameDraft.seed,
        npcLineup: gameDraft.npcLineup,
        npcDefinitions,
        npcStrategyProfiles: strategyProfiles,
      }),
    [gameDraft, npcDefinitions, strategyProfiles],
  )
  const controllerPreview = useMemo(
    () => gameBlueprintToControllerConfig(
      resolvedBlueprint,
      npcDefinitions,
      resolvedBlueprint.seedPolicy === 'random' ? '[resolved when table opens]' : resolvedBlueprint.seed,
    ),
    [npcDefinitions, resolvedBlueprint],
  )
  const filteredLobbyTables = useMemo(
    () => lobbyTables.filter((table) => matchesLobbyTableFilter(table, lobbyTableFilter)),
    [lobbyTableFilter, lobbyTables],
  )
  const currentStrategyProfiles = useMemo(
    () => latestStrategyProfiles(strategyProfiles),
    [strategyProfiles],
  )

  const refreshArchives = useCallback(async () => {
    const sessions = await archiveStoreRef.current.listArchivedSessions()
    setArchivedSessions(sessions)
    const details = await Promise.all(sessions.map((session) => archiveStoreRef.current.readArchivedSession(session.matchId)))
    setStrategyEvidence(deriveNpcStrategyEvidence(details.filter((detail): detail is ArchivedSessionDetail => Boolean(detail))))
    if (selectedArchive && !sessions.some((session) => session.matchId === selectedArchive.session.matchId)) {
      setSelectedArchive(null)
    }
  }, [selectedArchive])

  const refreshNpcRegistry = useCallback(async () => {
    const snapshot = await npcRegistryRef.current.snapshot()
    setNpcDefinitions(snapshot.definitions)
    setStrategyProfiles(snapshot.strategyProfiles)
  }, [])

  const refreshBlueprintStore = useCallback(async () => {
    const snapshot = await blueprintStoreRef.current.snapshot()
    setBlueprintRecords(snapshot.blueprints)
    setLobbyTables(snapshot.lobbyTables)
  }, [])

  useEffect(() => {
    void refreshArchives()
  }, [refreshArchives])

  useEffect(() => {
    void refreshNpcRegistry()
  }, [refreshNpcRegistry])

  useEffect(() => {
    void refreshBlueprintStore()
  }, [refreshBlueprintStore])

  async function updateNpc(id: string, patch: Partial<NpcDefinition>) {
    const existing = npcDefinitions.find((npc) => npc.id === id)
    if (!existing) {
      return
    }
    const draft = { ...existing, ...patch }
    setNpcDefinitions((current) => current.map((npc) => (npc.id === id ? draft : npc)))
    try {
      const updated = await npcRegistryRef.current.upsertDefinition(draft)
      setNpcDefinitions((current) => current.map((npc) => (npc.id === id ? updated : npc)))
      setOperatorMessage(`NPC ${updated.name} saved to the local registry.`)
    } catch (error) {
      setNpcDefinitions((current) => current.map((npc) => (npc.id === id ? existing : npc)))
      setOperatorMessage(error instanceof Error ? error.message : String(error))
    }
  }

  async function createStrategyProfileVersion(sourceProfileId: string, profile: NpcStrategyProfile) {
    const created = await npcRegistryRef.current.createStrategyProfileVersion(sourceProfileId, profile)
    await refreshNpcRegistry()
    setOperatorMessage(`Created ${created.name} v${created.version}. It is now available for NPC assignment.`)
  }

  function updateGame(patch: Partial<AdminGameDraft>) {
    setGameDraft((current) => ({ ...current, ...patch }))
  }

  function changeMode(mode: GameBlueprintMode) {
    setGameDraft((current) => ({
      ...current,
      mode,
      npcLineup: defaultNpcLineup(mode),
    }))
  }

  function assignSeat(seatId: string, npcDefinitionId: string) {
    setGameDraft((current) => ({
      ...current,
      npcLineup: current.npcLineup.map((assignment) =>
        assignment.seatId === seatId ? { ...assignment, npcDefinitionId } : assignment,
      ),
    }))
  }

  async function saveBlueprintDraft() {
    try {
      const record = await blueprintStoreRef.current.upsertBlueprint(resolvedBlueprint, 'draft')
      await refreshBlueprintStore()
      setOperatorMessage(`Saved ${record.blueprint.name} v${record.blueprint.version} as a reusable blueprint draft.`)
    } catch (error) {
      setOperatorMessage(error instanceof Error ? error.message : String(error))
    }
  }

  async function openLobbyTable() {
    try {
      const table = await blueprintStoreRef.current.createLobbyTable(resolvedBlueprint, 'open')
      await refreshBlueprintStore()
      setOperatorMessage(`Opened lobby table ${table.tableId} from ${table.blueprint.name} v${table.blueprintVersion}.`)
    } catch (error) {
      setOperatorMessage(error instanceof Error ? error.message : String(error))
    }
  }

  async function cancelLobbyTable(tableId: string) {
    try {
      await blueprintStoreRef.current.cancelLobbyTable(tableId)
      await refreshBlueprintStore()
      setOperatorMessage(`Cancelled lobby table ${tableId}.`)
    } catch (error) {
      setOperatorMessage(error instanceof Error ? error.message : String(error))
    }
  }

  async function openArchive(matchId: string) {
    const detail = await archiveStoreRef.current.readArchivedSession(matchId)
    setSelectedArchive(detail ?? null)
  }

  async function deleteArchive(matchId: string) {
    await archiveStoreRef.current.deleteArchivedSession(matchId)
    await refreshArchives()
  }

  async function setImportStatus(matchId: string, status: ImportWorkflowStatus) {
    await archiveStoreRef.current.updateImportStatus(matchId, status)
    await refreshArchives()
    await openArchive(matchId)
    setOperatorMessage(`Archive ${matchId} marked ${status}.`)
  }

  async function generatePublicCsv(session: ArchivedSessionRecord) {
    if (!session.publicPackage) {
      return
    }
    const csv = completedSessionPackageToParaPokerSiteCsv(session.publicPackage)
    downloadText(`parapoker-${session.matchId}-hand-history.csv`, csv, 'text/csv;charset=utf-8')
    await setImportStatus(session.matchId, 'csv-generated')
  }

  function downloadPublicPackage(session: ArchivedSessionRecord) {
    if (!session.publicPackage) {
      return
    }
    downloadText(
      `parapoker-${session.matchId}-public-package.json`,
      JSON.stringify(session.publicPackage, null, 2),
      'application/json;charset=utf-8',
    )
  }

  function downloadRestrictedArchive(detail: ArchivedSessionDetail) {
    if (!detail.session.authorityArchive) {
      return
    }
    downloadText(
      `parapoker-${detail.session.matchId}-restricted-authority-archive.json`,
      JSON.stringify(detail.session.authorityArchive, null, 2),
      'application/json;charset=utf-8',
    )
  }

  return (
    <main className="admin-shell">
      <section className="admin-panel admin-heading admin-overview-panel" aria-label="Admin overview">
        <div>
          <p className="eyebrow">ParaPoker Local Admin</p>
          <h1>NPC and Game Configuration</h1>
        </div>
        <span className="status-pill">Local draft</span>
      </section>

      <section className="admin-panel admin-history-panel" aria-label="Archived hand histories">
        <div className="section-heading">
          <h2>Operator Hand Histories</h2>
          <span>{archivedSessions.length} archived matches</span>
        </div>
        <p className="muted">{operatorMessage}</p>
        <div className="admin-list">
          {archivedSessions.length === 0 && <p className="muted">No completed local histories have been retained yet.</p>}
          {archivedSessions.map((session) => (
            <article className="admin-row history-row" key={session.matchId}>
              <div>
                <strong>{session.matchId}</strong>
                <span>{session.mode} - {session.status} - {session.importStatus ?? 'not-submitted'}</span>
              </div>
              <div>
                <span>{session.participants.map((participant) => participant.displayName).join(', ')}</span>
                <span>{session.handCount} hands - {session.visibility} - {session.sourceAuthority}</span>
              </div>
              <div>
                <span>{session.startedAt}</span>
                <span>{session.completedAt ?? 'In progress'}</span>
                <span>{session.packageChecksum ?? 'No package yet'}</span>
              </div>
              <div className="history-actions">
                <button type="button" onClick={() => void openArchive(session.matchId)}>
                  Open details
                </button>
                <button type="button" onClick={() => void generatePublicCsv(session)} disabled={!session.publicPackage}>
                  Generate CSV
                </button>
                <button type="button" onClick={() => downloadPublicPackage(session)} disabled={!session.publicPackage}>
                  Public package
                </button>
                <button type="button" onClick={() => void setImportStatus(session.matchId, 'submitted')} disabled={!session.publicPackage}>
                  Mark submitted
                </button>
                <button type="button" onClick={() => void setImportStatus(session.matchId, 'imported')} disabled={!session.publicPackage}>
                  Mark imported
                </button>
                <button type="button" onClick={() => void setImportStatus(session.matchId, 'import-failed')} disabled={!session.publicPackage}>
                  Mark failed
                </button>
                <button type="button" className="danger" onClick={() => void deleteArchive(session.matchId)}>
                  Delete local archive
                </button>
              </div>
            </article>
          ))}
        </div>
        {selectedArchive && (
          <div className="archive-detail" aria-label="Archived hand details">
            <div className="section-heading">
              <h2>{selectedArchive.session.matchId}</h2>
              <span>{selectedArchive.hands.length} hands</span>
            </div>
            <dl className="result-grid">
              <Metric label="Status" value={selectedArchive.session.status} />
              <Metric label="Import" value={selectedArchive.session.importStatus ?? 'not exported'} />
              <Metric label="Checksum" value={selectedArchive.session.packageChecksum ?? 'none'} />
              <Metric label="Authority" value={selectedArchive.session.sourceAuthority} />
              <Metric label="Restricted" value={selectedArchive.session.authorityArchive ? 'retained' : 'missing'} />
              <Metric label="Events" value={String(selectedArchive.session.authorityArchive?.events.length ?? 0)} />
              <Metric label="Private hands" value={String(selectedArchive.privateHands.length)} />
            </dl>
            <div className="history-actions">
              <button type="button" onClick={() => downloadPublicPackage(selectedArchive.session)} disabled={!selectedArchive.session.publicPackage}>
                Download public package
              </button>
              <button type="button" onClick={() => void generatePublicCsv(selectedArchive.session)} disabled={!selectedArchive.session.publicPackage}>
                Generate public CSV
              </button>
              <button type="button" onClick={() => downloadRestrictedArchive(selectedArchive)} disabled={!selectedArchive.session.authorityArchive}>
                Download restricted archive
              </button>
            </div>
            {selectedArchive.session.authorityArchive && (
              <>
                <div className="strategy-card">
                  <div>
                    <strong>Authority Archive</strong>
                    <span>{selectedArchive.session.authorityArchive.integrity.checksum}</span>
                  </div>
                  <p>
                    {selectedArchive.session.authorityArchive.authorityClass} - {selectedArchive.session.authorityArchive.closure.reason} - {selectedArchive.session.authorityArchive.integrity.eventCount} events
                  </p>
                  <p>
                    Commands {selectedArchive.session.authorityArchive.integrity.commandCount} - Hands {selectedArchive.session.authorityArchive.integrity.handCount} - NPC decisions {selectedArchive.session.authorityArchive.integrity.npcDecisionCount ?? 0}
                  </p>
                </div>
                <NpcDecisionTraceInspection traces={selectedArchive.session.authorityArchive.npcDecisionTraces ?? []} />
              </>
            )}
            <div className="admin-list">
              {selectedArchive.hands.map((hand) => (
                <article className="strategy-card" key={hand.handId}>
                  <div>
                    <strong>Hand {hand.handNumber}</strong>
                    <span>{hand.potAwards.map((award) => `${award.seatId} +${award.amount}`).join(', ')}</span>
                  </div>
                  <p>Board {hand.board.join(' ') || 'none'} - {hand.actions.length} actions</p>
                  <p>Revealed {Object.keys(hand.revealedCards).join(', ') || 'none'}</p>
                </article>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="admin-panel admin-npc-panel" aria-label="NPC definitions">
        <div className="section-heading">
          <h2>NPCs</h2>
          <span>{npcDefinitions.length} definitions</span>
        </div>
        <div className="admin-list">
          {npcDefinitions.map((npc) => (
            <article className="admin-row" key={npc.id}>
              <label>
                <span>Name</span>
                <input
                  aria-label={`${npc.id} name`}
                  value={npc.name}
                  onChange={(event) => void updateNpc(npc.id, { name: event.target.value })}
                />
              </label>
              <label>
                <span>Archetype</span>
                <input
                  aria-label={`${npc.id} archetype`}
                  value={npc.archetypeLabel}
                  onChange={(event) => void updateNpc(npc.id, { archetypeLabel: event.target.value })}
                />
              </label>
              <label>
                <span>Strategy</span>
                <select
                  aria-label={`${npc.id} strategy`}
                  value={npc.strategyProfileId}
                  onChange={(event) => void updateNpc(npc.id, { strategyProfileId: event.target.value })}
                >
                  {strategyProfiles
                    .filter((profile) => profile.status === 'active' || profile.id === npc.strategyProfileId)
                    .map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name} v{profile.version}
                    </option>
                    ))}
                </select>
              </label>
            </article>
          ))}
        </div>
      </section>

      <section
        className={`admin-panel strategy-panel admin-strategy-panel ${showStrategyWorkspace ? 'editor-open' : ''}`}
        aria-label="Strategy profiles"
      >
        <div className="section-heading">
          <h2>Strategies</h2>
          <div className="section-heading-actions">
            <span>{currentStrategyProfiles.length} current / {strategyProfiles.length} versions</span>
            <button
              type="button"
              aria-expanded={showStrategyWorkspace}
              onClick={() => setShowStrategyWorkspace((isOpen) => !isOpen)}
            >
              {showStrategyWorkspace ? 'Close strategy editor' : 'Open strategy editor'}
            </button>
          </div>
        </div>
        <div className="strategy-grid">
          {currentStrategyProfiles.map((profile) => (
            <article className="strategy-card" key={profile.id}>
              <div>
                <strong>
                  {profile.name} v{profile.version}
                </strong>
                <span>{profile.status}</span>
              </div>
              <dl>
                <Metric label="Preflop" value={profile.policyConfig.preflopAggression.toFixed(2)} />
                <Metric label="Looseness" value={profile.policyConfig.preflopLooseness.toFixed(2)} />
                <Metric label="Postflop" value={profile.policyConfig.postflopAggression.toFixed(2)} />
                <Metric label="Pressure" value={profile.policyConfig.pressureRaiseMultiplier.toFixed(1)} />
              </dl>
              <p>{profile.modules.filter((module) => module.enabled).map((module) => module.id).join(', ')}</p>
              <p>{profile.teaching?.teachingObjective ?? 'No teaching objective configured.'}</p>
            </article>
          ))}
        </div>
        {showStrategyWorkspace && (
          <AdminStrategyWorkspace
            profiles={strategyProfiles}
            evidence={strategyEvidence}
            onCreateVersion={createStrategyProfileVersion}
          />
        )}
      </section>

      <section className="admin-panel admin-blueprint-panel" aria-label="Game blueprint builder">
        <div className="section-heading">
          <h2>Game Blueprint</h2>
          <span>{gameDraft.mode}</span>
        </div>
        <div className="admin-controls">
          <label>
            <span>Mode</span>
            <select aria-label="Admin game mode" value={gameDraft.mode} onChange={(event) => changeMode(event.target.value as GameBlueprintMode)}>
              <option value="heads-up">Heads-up</option>
              <option value="six-max">Six-max</option>
            </select>
          </label>
          <label>
            <span>Visibility</span>
            <select
              aria-label="Admin game visibility"
              value={gameDraft.visibility}
              onChange={(event) => updateGame({ visibility: event.target.value as GameVisibility })}
            >
              <option value="private">Private</option>
              <option value="unlisted">Unlisted</option>
              <option value="public">Public</option>
            </select>
          </label>
          <NumberControl label="Admin starting stack" title="Stack" value={gameDraft.startingStack} onChange={(startingStack) => updateGame({ startingStack })} />
          <NumberControl label="Admin small blind" title="SB" value={gameDraft.smallBlind} onChange={(smallBlind) => updateGame({ smallBlind })} />
          <NumberControl label="Admin big blind" title="BB" value={gameDraft.bigBlind} onChange={(bigBlind) => updateGame({ bigBlind })} />
          <label className="toggle-field">
            <input
              aria-label="Random seed per table"
              type="checkbox"
              checked={gameDraft.seedPolicy === 'random'}
              onChange={(event) => updateGame({ seedPolicy: event.target.checked ? 'random' : 'fixed' })}
            />
            <span>Random seed per table</span>
          </label>
          <label>
            <span>Seed</span>
            <input
              aria-label="Admin seed"
              value={gameDraft.seed}
              disabled={gameDraft.seedPolicy === 'random'}
              placeholder={gameDraft.seedPolicy === 'random' ? 'Resolved when table opens' : undefined}
              onChange={(event) => updateGame({ seed: event.target.value })}
            />
          </label>
        </div>

        <div className="lineup-grid" aria-label="Seat lineup">
          {gameDraft.npcLineup.map((assignment) => (
            <label key={assignment.seatId}>
              <span>{assignment.seatId}</span>
              <select
                aria-label={`${assignment.seatId} NPC assignment`}
                value={assignment.npcDefinitionId}
                onChange={(event) => assignSeat(assignment.seatId, event.target.value)}
              >
                {activeNpcDefinitions.map((npc) => (
                  <option key={npc.id} value={npc.id}>
                    {npc.name}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>

        <div className="admin-actions">
          <button type="button" onClick={() => void saveBlueprintDraft()}>
            Save draft
          </button>
          <button type="button" onClick={() => void openLobbyTable()}>
            Open lobby table
          </button>
        </div>
      </section>

      <section className="admin-panel admin-lobby-panel" aria-label="Lobby table drafts">
        <div className="section-heading">
          <h2>Lobby Tables</h2>
          <label>
            <span>Status</span>
            <select
              aria-label="Lobby table status filter"
              value={lobbyTableFilter}
              onChange={(event) => setLobbyTableFilter(event.target.value as LobbyTableFilter)}
            >
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="closed">Closed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>
          <span>{filteredLobbyTables.length} of {lobbyTables.length} instances</span>
        </div>
        <div className="admin-list">
          {filteredLobbyTables.length === 0 ? (
            <p>{lobbyTables.length === 0 ? 'No lobby tables have been created yet.' : `No ${lobbyTableFilter} lobby tables.`}</p>
          ) : (
            filteredLobbyTables.map((table) => (
              <article className="admin-row" key={table.tableId}>
                <div>
                  <strong>{table.blueprint.name}</strong>
                  <span>
                    {table.status} · {table.blueprint.mode} · v{table.blueprintVersion}
                  </span>
                </div>
                <span>
                  {table.tableId} · {table.blueprint.seedPolicy === 'random' ? 'random seed' : 'fixed seed'}
                </span>
                {table.status === 'open' || table.status === 'draft' ? (
                  <button type="button" onClick={() => void cancelLobbyTable(table.tableId)}>
                    Cancel
                  </button>
                ) : null}
              </article>
            ))
          )}
        </div>
      </section>

      <section className="admin-panel admin-saved-panel" aria-label="Saved game blueprints">
        <div className="section-heading">
          <h2>Saved Blueprints</h2>
          <span>{blueprintRecords.length} records</span>
        </div>
        <div className="admin-list">
          {blueprintRecords.length === 0 ? (
            <p>No reusable blueprints have been saved yet.</p>
          ) : (
            blueprintRecords.map((record) => (
              <article className="admin-row" key={record.blueprint.id}>
                <div>
                  <strong>{record.blueprint.name}</strong>
                  <span>
                    {record.status} · {record.blueprint.mode} · {record.blueprint.visibility}
                  </span>
                </div>
                <span>
                  v{record.blueprint.version} · {record.blueprint.seats.length} seats
                </span>
              </article>
            ))
          )}
        </div>
      </section>

      <section className="admin-panel admin-preview-panel" aria-label="Configuration preview">
        <div className="section-heading">
          <h2>Preview</h2>
          <span>{resolvedBlueprint.seats.length} seats</span>
        </div>
        <div className="preview-grid">
          <pre>{JSON.stringify(resolvedBlueprint, null, 2)}</pre>
          <pre>{JSON.stringify(controllerPreview, null, 2)}</pre>
        </div>
      </section>
    </main>
  )
}

function matchesLobbyTableFilter(table: LobbyTableInstance, filter: LobbyTableFilter): boolean {
  if (filter === 'all') {
    return true
  }
  if (filter === 'active') {
    return table.status === 'open' || table.status === 'running'
  }
  return table.status === filter
}

function downloadText(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function latestStrategyProfiles(profiles: readonly NpcStrategyProfile[]): NpcStrategyProfile[] {
  const latest = new Map<string, NpcStrategyProfile>()
  for (const profile of profiles) {
    const current = latest.get(profile.name)
    if (!current || profile.version > current.version) {
      latest.set(profile.name, profile)
    }
  }
  return [...latest.values()].sort((left, right) => left.name.localeCompare(right.name))
}

function NpcDecisionTraceInspection({ traces }: { traces: NpcDecisionTrace[] }) {
  const sourceCounts = Object.fromEntries(
    ['preflop-range', 'proactive-postflop', 'postflop-defense', 'legacy-fallback', 'safety-fallback']
      .map((source) => [source, traces.filter((trace) => trace.decisionSource === source).length]),
  )
  const fallbackCount = sourceCounts['legacy-fallback'] + sourceCounts['safety-fallback']
  return (
    <section className="decision-trace-inspection" aria-label="NPC decision trace inspection">
      <div className="section-heading">
        <h3>NPC Decision Evidence</h3>
        <span>{traces.length} private traces</span>
      </div>
      {traces.length === 0 ? <p className="muted">No archived decision traces for this session.</p> : (
        <>
          <dl className="result-grid">
            <Metric label="Preflop range" value={String(sourceCounts['preflop-range'])} />
            <Metric label="Proactive" value={String(sourceCounts['proactive-postflop'])} />
            <Metric label="Defense" value={String(sourceCounts['postflop-defense'])} />
            <Metric label="Fallback" value={`${fallbackCount} (${(fallbackCount / traces.length * 100).toFixed(1)}%)`} />
          </dl>
          <div className="admin-list decision-trace-list">
            {traces.slice(-20).reverse().map((trace, index) => (
              <article className="admin-row" key={`${trace.handNumber}:${trace.seatId}:${trace.selectedAction}:${index}`}>
                <div><strong>Hand {trace.handNumber} · {trace.seatId}</strong><span>{trace.street} · {trace.decisionSource}</span></div>
                <div><strong>{trace.selectedAction}{trace.selectedAmount !== undefined ? ` ${trace.selectedAmount}` : ''}</strong><span>{trace.reasonCode}</span></div>
                <div><span>{trace.situationId ?? 'no situation id'}</span><span>{trace.handClass ?? 'no hand class'}</span></div>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  )
}

function NumberControl({
  label,
  title,
  value,
  onChange,
}: {
  label: string
  title: string
  value: number
  onChange: (value: number) => void
}) {
  return (
    <label>
      <span>{title}</span>
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
