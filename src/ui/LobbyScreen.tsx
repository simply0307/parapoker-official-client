import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  IndexedDbGameBlueprintStore,
  type GameBlueprintStore,
  type LobbyTableInstance,
} from '../game-config/gameBlueprintStore'

interface LobbyScreenProps {
  activeTableIds: string[]
  onJoinTable: (table: LobbyTableInstance) => void
  onOpenAdmin?: () => void
  storeFactory?: () => GameBlueprintStore
}

export function LobbyScreen({
  activeTableIds,
  onJoinTable,
  onOpenAdmin = () => {},
  storeFactory = () => new IndexedDbGameBlueprintStore(),
}: LobbyScreenProps) {
  const storeRef = useRef<GameBlueprintStore | null>(null)
  const [tables, setTables] = useState<LobbyTableInstance[]>([])
  const [message, setMessage] = useState('Lobby reads operator-created tables from the local blueprint store.')

  if (!storeRef.current) {
    storeRef.current = storeFactory()
  }

  const openTables = useMemo(() => tables.filter((table) => table.status === 'open'), [tables])
  const activeTableIdSet = useMemo(() => new Set(activeTableIds), [activeTableIds])
  const activeCount = activeTableIds.length

  const refreshLobby = useCallback(async () => {
    const store = storeRef.current
    if (!store) return
    setTables(await store.listLobbyTables())
  }, [])

  useEffect(() => {
    void refreshLobby()
  }, [refreshLobby])

  function joinTable(table: LobbyTableInstance) {
    if (activeTableIdSet.has(table.tableId)) {
      setMessage('That table is already active in your client.')
      onJoinTable(table)
      return
    }
    if (activeCount >= 4) {
      setMessage('You can keep up to 4 active tables in this browser client.')
      return
    }
    setMessage(`Joined ${table.blueprint.name}. This local client still is not trusted seat authority.`)
    onJoinTable(table)
  }

  return (
    <main className="lobby-shell" aria-label="ParaPoker lobby">
      <header className="lobby-header">
        <div>
          <p className="eyebrow">Competition lobby</p>
          <h1>Open Tables</h1>
          <p>Choose an operator-created freezeout and take your seat.</p>
        </div>
        <button type="button" className="lobby-refresh" onClick={() => void refreshLobby()}>
          <span aria-hidden="true">&#8635;</span> Refresh
        </button>
      </header>

      <section className="lobby-overview" aria-label="Lobby status">
        <dl className="lobby-metrics">
          <Metric label="Open tables" value={openTables.length} />
          <Metric label="Active tables" value={`${activeCount}/4`} />
          <Metric label="Client mode" value="Play money" />
        </dl>
        <p role="status">{message}</p>
      </section>

      <section className="lobby-tables" aria-label="Open lobby tables">
        <div className="section-heading">
          <h2>Available now</h2>
          <span>{openTables.length === 1 ? '1 table' : `${openTables.length} tables`}</span>
        </div>
        <div className="lobby-table-list">
          {openTables.length === 0 ? (
            <div className="empty-lobby">
              <div className="empty-table-motif" aria-hidden="true"><span /><span /></div>
              <div>
                <strong>No tables are open</strong>
                <span>Open a heads-up or six-max freezeout from the operator workspace.</span>
              </div>
              <button type="button" onClick={onOpenAdmin}>Open Admin</button>
            </div>
          ) : (
            openTables.map((table) => {
              const alreadyActive = activeTableIdSet.has(table.tableId)
              const npcNames = table.blueprint.seats
                .filter((seat) => seat.kind === 'npc')
                .map((seat) => seat.displayName ?? formatNpcName(seat.npcDefinitionId))
              const seated = table.blueprint.seats.length
              const capacity = table.blueprint.mode === 'six-max' ? 6 : 2
              return (
                <article className="lobby-table-card" key={table.tableId}>
                  <header>
                    <div>
                      <span className="format-badge">{table.blueprint.mode === 'six-max' ? '6-max' : 'Heads-up'}</span>
                      <strong>{table.blueprint.name}</strong>
                    </div>
                    <span className="visibility-badge">{table.blueprint.visibility}</span>
                  </header>
                  <dl>
                    <Metric label="Blinds" value={`${table.blueprint.smallBlind}/${table.blueprint.bigBlind}`} />
                    <Metric label="Starting stack" value={table.blueprint.startingStack} />
                    <Metric label="Seated" value={`${seated}/${capacity}`} />
                    <Metric label="Available" value={Math.max(0, capacity - seated)} />
                  </dl>
                  <div className="lobby-lineup">
                    <span>Lineup</span>
                    <strong>{npcNames.join(', ') || 'Human seats'}</strong>
                  </div>
                  <p>Blueprint v{table.blueprintVersion} - {table.blueprint.seedPolicy === 'random' ? 'random seed' : 'fixed seed'}</p>
                  <button
                    type="button"
                    className="primary"
                    onClick={() => joinTable(table)}
                    disabled={!alreadyActive && activeCount >= 4}
                  >
                    {alreadyActive ? 'View table' : 'Join table'}
                  </button>
                </article>
              )
            })
          )}
        </div>
      </section>
    </main>
  )
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>
}

function formatNpcName(npcDefinitionId?: string): string {
  if (!npcDefinitionId) return 'NPC'
  return npcDefinitionId.replace(/^npc-/, '').split('-')
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}
