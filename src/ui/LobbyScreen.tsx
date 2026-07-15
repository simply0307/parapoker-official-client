import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  IndexedDbGameBlueprintStore,
  type GameBlueprintStore,
  type LobbyTableInstance,
} from '../game-config/gameBlueprintStore'

interface LobbyScreenProps {
  activeTableIds: string[]
  onJoinTable: (table: LobbyTableInstance) => void
  storeFactory?: () => GameBlueprintStore
}

export function LobbyScreen({
  activeTableIds,
  onJoinTable,
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
    if (!store) {
      return
    }
    const nextTables = await store.listLobbyTables()
    setTables(nextTables)
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
      <section className="lobby-panel lobby-hero">
        <div>
          <p className="eyebrow">ParaPoker Lobby</p>
          <h1>Open Tables</h1>
          <p>Join operator-created local prototype tables. Multiplayer seat ownership still requires future server authority.</p>
        </div>
        <dl className="lobby-metrics">
          <Metric label="Open" value={openTables.length} />
          <Metric label="Active" value={`${activeCount}/4`} />
        </dl>
        <button type="button" onClick={() => void refreshLobby()}>
          Refresh lobby
        </button>
      </section>

      <section className="lobby-panel" aria-label="Open lobby tables">
        <div className="section-heading">
          <h2>Tables</h2>
          <span>{message}</span>
        </div>
        <div className="lobby-table-list">
          {openTables.length === 0 ? (
            <div className="empty-lobby">
              <strong>No open lobby tables</strong>
              <span>Use Admin to open a heads-up or six-max local table draft.</span>
            </div>
          ) : (
            openTables.map((table) => {
              const alreadyActive = activeTableIdSet.has(table.tableId)
              return (
                <article className="lobby-table-card" key={table.tableId}>
                  <div>
                    <strong>{table.blueprint.name}</strong>
                    <span>{table.tableId}</span>
                  </div>
                  <dl>
                    <Metric label="Mode" value={table.blueprint.mode} />
                    <Metric label="Blinds" value={`${table.blueprint.smallBlind}/${table.blueprint.bigBlind}`} />
                    <Metric label="Stack" value={table.blueprint.startingStack} />
                    <Metric label="Seats" value={table.blueprint.seats.length} />
                  </dl>
                  <p>
                    {table.blueprint.visibility} · blueprint v{table.blueprintVersion} ·{' '}
                    {table.blueprint.seedPolicy === 'random' ? 'random seed' : `seed ${String(table.blueprint.seed)}`}
                  </p>
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
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}
