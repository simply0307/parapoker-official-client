import { useState } from 'react'
import { AdminPortal } from './ui/AdminPortal'
import { LobbyScreen } from './ui/LobbyScreen'
import { PokerTable } from './ui/PokerTable'
import { SupabaseIdentityWidget } from './ui/SupabaseIdentityWidget'
import type { LobbyTableInstance } from './game-config/gameBlueprintStore'

type AppScreen = 'lobby' | 'play' | 'admin'

function App() {
  const [screen, setScreen] = useState<AppScreen>('lobby')
  const [joinedTable, setJoinedTable] = useState<LobbyTableInstance | null>(null)
  const [activeTables, setActiveTables] = useState<LobbyTableInstance[]>([])

  function joinTable(table: LobbyTableInstance) {
    setJoinedTable(table)
    setActiveTables((current) => current.some((activeTable) => activeTable.tableId === table.tableId) ? current : [...current, table].slice(0, 4))
    setScreen('play')
  }

  return (
    <>
      <SupabaseIdentityWidget />
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
      {screen === 'play' && (
        <PokerTable
          joinedTable={joinedTable}
          joinedTables={activeTables}
          openAdmin={() => setScreen('admin')}
        />
      )}
    </>
  )
}

export default App
