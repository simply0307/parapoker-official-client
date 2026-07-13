import { useState } from 'react'
import { AdminPortal } from './ui/AdminPortal'
import { PokerTable } from './ui/PokerTable'
import { SupabaseIdentityWidget } from './ui/SupabaseIdentityWidget'

type AppScreen = 'play' | 'admin'

function App() {
  const [screen, setScreen] = useState<AppScreen>('play')

  return (
    <>
      <SupabaseIdentityWidget />
      <nav className="app-nav" aria-label="Client sections">
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
      {screen === 'admin' ? <AdminPortal /> : <PokerTable openAdmin={() => setScreen('admin')} />}
    </>
  )
}

export default App
