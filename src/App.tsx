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
  const [activeTableIds, setActiveTableIds] = useState<string[]>([])

  function joinTable(table: LobbyTableInstance) {
    setJoinedTable(table)
    setActiveTableIds((current) => current.includes(table.tableId) ? current : [...current, table.tableId].slice(0, 4))
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
          activeTableIds={activeTableIds}
          onJoinTable={joinTable}
        />
      )}
      {screen === 'play' && (
        <PokerTable
          joinedTable={joinedTable}
          openAdmin={() => setScreen('admin')}
        />
      )}
    </>
  )
}

export default App
