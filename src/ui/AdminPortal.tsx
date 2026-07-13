import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createGameBlueprint,
  defaultNpcLineup,
  gameBlueprintToControllerConfig,
  type GameBlueprintMode,
  type GameVisibility,
} from '../game-config/gameBlueprint'
import type { NpcDefinition, NpcSeatAssignment, NpcStrategyProfile } from '../npc/config'
import { LOCAL_NPC_DEFINITIONS, LOCAL_NPC_STRATEGY_PROFILES } from '../npc/roster'
import {
  IndexedDbHandHistoryArchiveStore,
  type ArchivedSessionDetail,
  type ArchivedSessionRecord,
} from '../persistence'
import { completedSessionPackageToPokerNowCsv } from '../exports/pokerNowCsv'

interface AdminNpcDraft {
  id: string
  name: string
  archetypeLabel: string
  strategyProfileId: string
  status: NpcDefinition['status']
}

interface AdminGameDraft {
  mode: GameBlueprintMode
  visibility: GameVisibility
  startingStack: number
  smallBlind: number
  bigBlind: number
  seed: string
  npcLineup: NpcSeatAssignment[]
}

export function AdminPortal() {
  const archiveStoreRef = useRef(new IndexedDbHandHistoryArchiveStore())
  const [npcDrafts, setNpcDrafts] = useState<AdminNpcDraft[]>(() =>
    LOCAL_NPC_DEFINITIONS.map((npc) => ({
      id: npc.id,
      name: npc.name,
      archetypeLabel: npc.archetypeLabel,
      strategyProfileId: npc.strategyProfileId,
      status: npc.status,
    })),
  )
  const [strategyProfiles] = useState<NpcStrategyProfile[]>(LOCAL_NPC_STRATEGY_PROFILES)
  const [gameDraft, setGameDraft] = useState<AdminGameDraft>(() => ({
    mode: 'heads-up',
    visibility: 'private',
    startingStack: 200,
    smallBlind: 1,
    bigBlind: 2,
    seed: 'admin-preview',
    npcLineup: defaultNpcLineup('heads-up'),
  }))
  const [archivedSessions, setArchivedSessions] = useState<ArchivedSessionRecord[]>([])
  const [selectedArchive, setSelectedArchive] = useState<ArchivedSessionDetail | null>(null)

  const activeNpcDrafts = npcDrafts.filter((npc) => npc.status === 'active')
  const npcDefinitions = useMemo<NpcDefinition[]>(
    () =>
      npcDrafts.map((npc) => ({
        ...npc,
        strategyProfileId: npc.strategyProfileId,
      })),
    [npcDrafts],
  )
  const resolvedBlueprint = useMemo(
    () =>
      createGameBlueprint({
        mode: gameDraft.mode,
        visibility: gameDraft.visibility,
        startingStack: gameDraft.startingStack,
        smallBlind: gameDraft.smallBlind,
        bigBlind: gameDraft.bigBlind,
        seed: gameDraft.seed,
        npcLineup: gameDraft.npcLineup,
      }),
    [gameDraft],
  )
  const controllerPreview = useMemo(
    () => gameBlueprintToControllerConfig(resolvedBlueprint, npcDefinitions),
    [npcDefinitions, resolvedBlueprint],
  )

  const refreshArchives = useCallback(async () => {
    const sessions = await archiveStoreRef.current.listArchivedSessions()
    setArchivedSessions(sessions)
    if (selectedArchive && !sessions.some((session) => session.matchId === selectedArchive.session.matchId)) {
      setSelectedArchive(null)
    }
  }, [selectedArchive])

  useEffect(() => {
    void refreshArchives()
  }, [refreshArchives])

  function updateNpc(id: string, patch: Partial<AdminNpcDraft>) {
    setNpcDrafts((current) => current.map((npc) => (npc.id === id ? { ...npc, ...patch } : npc)))
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

  async function openArchive(matchId: string) {
    const detail = await archiveStoreRef.current.readArchivedSession(matchId)
    setSelectedArchive(detail ?? null)
  }

  async function deleteArchive(matchId: string) {
    await archiveStoreRef.current.deleteArchivedSession(matchId)
    await refreshArchives()
  }

  async function markImported(matchId: string) {
    await archiveStoreRef.current.updateImportStatus(matchId, 'imported')
    await refreshArchives()
    await openArchive(matchId)
  }

  function downloadArchivePackage(session: ArchivedSessionRecord) {
    if (!session.publicPackage) {
      return
    }
    const csv = completedSessionPackageToPokerNowCsv(session.publicPackage)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `parapoker-${session.matchId}-hand-history.csv`
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <main className="admin-shell">
      <section className="admin-panel admin-heading" aria-label="Admin overview">
        <div>
          <p className="eyebrow">ParaPoker Local Admin</p>
          <h1>NPC and Game Configuration</h1>
        </div>
        <span className="status-pill">Local draft</span>
      </section>

      <section className="admin-panel admin-history-panel" aria-label="Archived hand histories">
        <div className="section-heading">
          <h2>Hand Histories</h2>
          <span>{archivedSessions.length} archived matches</span>
        </div>
        <div className="admin-list">
          {archivedSessions.length === 0 && <p className="muted">No completed local histories have been retained yet.</p>}
          {archivedSessions.map((session) => (
            <article className="admin-row history-row" key={session.matchId}>
              <div>
                <strong>{session.matchId}</strong>
                <span>{session.mode} - {session.status}</span>
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
                <button type="button" onClick={() => downloadArchivePackage(session)} disabled={!session.publicPackage}>
                  Download public CSV
                </button>
                <button type="button" onClick={() => void markImported(session.matchId)} disabled={!session.publicPackage}>
                  Mark imported
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
            </dl>
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

      <section className="admin-panel" aria-label="NPC definitions">
        <div className="section-heading">
          <h2>NPCs</h2>
          <span>{npcDrafts.length} definitions</span>
        </div>
        <div className="admin-list">
          {npcDrafts.map((npc) => (
            <article className="admin-row" key={npc.id}>
              <label>
                <span>Name</span>
                <input
                  aria-label={`${npc.id} name`}
                  value={npc.name}
                  onChange={(event) => updateNpc(npc.id, { name: event.target.value })}
                />
              </label>
              <label>
                <span>Archetype</span>
                <input
                  aria-label={`${npc.id} archetype`}
                  value={npc.archetypeLabel}
                  onChange={(event) => updateNpc(npc.id, { archetypeLabel: event.target.value })}
                />
              </label>
              <label>
                <span>Strategy</span>
                <select
                  aria-label={`${npc.id} strategy`}
                  value={npc.strategyProfileId}
                  onChange={(event) => updateNpc(npc.id, { strategyProfileId: event.target.value })}
                >
                  {strategyProfiles.map((profile) => (
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

      <section className="admin-panel" aria-label="Strategy profiles">
        <div className="section-heading">
          <h2>Strategies</h2>
          <span>{strategyProfiles.length} profiles</span>
        </div>
        <div className="strategy-grid">
          {strategyProfiles.map((profile) => (
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
            </article>
          ))}
        </div>
      </section>

      <section className="admin-panel" aria-label="Game blueprint builder">
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
          <label>
            <span>Seed</span>
            <input
              aria-label="Admin seed"
              value={gameDraft.seed}
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
                {activeNpcDrafts.map((npc) => (
                  <option key={npc.id} value={npc.id}>
                    {npc.name}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </section>

      <section className="admin-panel" aria-label="Configuration preview">
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
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
