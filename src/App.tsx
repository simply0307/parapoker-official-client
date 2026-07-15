import { useCallback, useState } from 'react'
import { AdminPortal } from './ui/AdminPortal'
import { LobbyScreen } from './ui/LobbyScreen'
import { PokerTable } from './ui/PokerTable'
import { SupabaseIdentityWidget } from './ui/SupabaseIdentityWidget'
import type { LobbyTableInstance } from './game-config/gameBlueprintStore'
import type { ClientPlayerIdentity } from './integrations/supabase/identityRepository'

type AppScreen = 'lobby' | 'play' | 'admin'

function App() {
  const [screen, setScreen] = useState<AppScreen>('lobby')
  const [joinedTable, setJoinedTable] = useState<LobbyTableInstance | null>(null)
  const [activeTables, setActiveTables] = useState<LobbyTableInstance[]>([])
  const [playerIdentity, setPlayerIdentity] = useState<ClientPlayerIdentity | null>(null)
  const [identityResolved, setIdentityResolved] = useState(false)

  const handleIdentityChange = useCallback((identity: ClientPlayerIdentity | null) => {
    setPlayerIdentity(identity)
    setIdentityResolved(true)
  }, [])

  const handleIdentityLoading = useCallback(() => {
    setPlayerIdentity(null)
    setIdentityResolved(false)
  }, [])

  function joinTable(table: LobbyTableInstance) {
    setJoinedTable(table)
    setActiveTables((current) => current.some((activeTable) => activeTable.tableId === table.tableId) ? current : [...current, table].slice(0, 4))
    setScreen('play')
  }

  function leaveTable(tableId: string) {
    const remaining = activeTables.filter((table) => table.tableId !== tableId)
    setActiveTables(remaining)
    setJoinedTable((selected) => selected?.tableId === tableId ? (remaining[0] ?? null) : selected)
    if (remaining.length === 0) {
      setScreen('lobby')
    }
  }

  return (
    <>
      <SupabaseIdentityWidget
        onIdentityChange={handleIdentityChange}
        onIdentityLoading={handleIdentityLoading}
      />
      <nav className="app-nav" aria-label="Client sections">
        <button
          type="button"
          className={screen === 'lobby' ? 'selected' : ''}
          aria-pressed={screen === 'lobby'}
          onClick={() => setScreen('lobby')}
        >
          Lobby
        </button>
        <button
          type="button"
          className={screen === 'play' ? 'selected' : ''}
          aria-pressed={screen === 'play'}
          onClick={() => setScreen('play')}
        >
          Play
        </button>
        <button
          type="button"
          className={screen === 'admin' ? 'selected' : ''}
          aria-pressed={screen === 'admin'}
          onClick={() => setScreen('admin')}
        >
          Admin
        </button>
      </nav>
      {screen === 'admin' && <AdminPortal />}
      {screen === 'lobby' && (
        <LobbyScreen
          activeTableIds={activeTables.map((table) => table.tableId)}
          onJoinTable={joinTable}
        />
      )}
      <div hidden={screen !== 'play'}>
        <PokerTable
          joinedTable={joinedTable}
          joinedTables={activeTables}
          playerIdentity={playerIdentity}
          identityResolved={identityResolved}
          openAdmin={() => setScreen('admin')}
          onLeaveTable={leaveTable}
        />
      </div>
    </>
  )
}

export default App
