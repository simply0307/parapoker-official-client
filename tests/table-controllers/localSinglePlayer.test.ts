import { describe, expect, it } from 'vitest'
import { LocalSinglePlayerController } from '../../src/table-controllers/local-single-player/LocalSinglePlayerController'

describe('local single-player controller', () => {
  it('keeps canonical state outside React and advances NPC turns', () => {
    const controller = new LocalSinglePlayerController({ seed: 'controller' })
    const firstSnapshot = controller.getSnapshot()

    expect(firstSnapshot.publicView.pendingSeatId).toBe('human')
    controller.submitHumanAction({ type: 'call' })
    const snapshot = controller.getSnapshot()

    expect(snapshot.publicView.pendingSeatId === 'human' || snapshot.publicView.status !== 'handInProgress').toBe(true)
    expect(JSON.stringify(snapshot.heroView)).not.toContain('deck')
    expect(controller.getCanonicalStateForTests().hand?.deck.length).toBeGreaterThan(0)
  })
})
