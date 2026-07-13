import { describe, expect, it } from 'vitest'
import type { NpcDecisionContext, NpcPolicy } from '../../src/npc/basicNpc'
import {
  createSixMaxSoloConfig,
  LocalSinglePlayerController,
} from '../../src/table-controllers/local-single-player/LocalSinglePlayerController'

describe('local single-player controller', () => {
  it('keeps canonical state outside React and advances NPC turns', () => {
    const controller = new LocalSinglePlayerController({ seed: 'controller' })
    const firstSnapshot = controller.getSnapshot()

    expect(firstSnapshot.publicView.pendingSeatId).toBe('human')
    const transition = controller.submitHumanAction({ type: 'call' })
    const snapshot = controller.getSnapshot()

    expect(transition.ok).toBe(true)
    expect(transition.events.some((event) => event.type === 'actionApplied' && event.payload.seatId === 'human')).toBe(true)
    expect(new Set(transition.events.map((event) => event.eventId)).size).toBe(transition.events.length)
    expect(snapshot.publicView.pendingSeatId === 'human' || snapshot.publicView.status !== 'handInProgress').toBe(true)
    expect(JSON.stringify(snapshot.heroView)).not.toContain('deck')
    expect(controller.getCanonicalStateForTests().hand?.deck.length).toBeGreaterThan(0)
  })

  it('starts six-max solo mode with one human and five independent NPC seats', () => {
    const controller = new LocalSinglePlayerController(createSixMaxSoloConfig({ seed: 'six-max-controller' }))
    const snapshot = controller.getSnapshot()
    const state = controller.getCanonicalStateForTests()

    expect(snapshot.publicView.seats).toHaveLength(6)
    expect(snapshot.heroView.heroSeatId).toBe('human')
    expect(snapshot.publicView.seats.filter((seat) => seat.kind === 'npc')).toHaveLength(5)
    expect(state.hand?.smallBlindSeatId).toBe('npc-1')
    expect(state.hand?.bigBlindSeatId).toBe('npc-2')
    expect(snapshot.publicView.pendingSeatId === 'human' || snapshot.publicView.status !== 'handInProgress').toBe(true)
    expect(JSON.stringify(snapshot.heroView)).not.toContain('deck')
    expect(JSON.stringify(snapshot.heroView)).not.toContain('rngState')
  })

  it('creates independent NPC policy runtimes from seat strategy profiles', () => {
    const created: Array<{ seatId: string; npcId: string; strategyProfileId: string; policy: NpcPolicy }> = []
    const controller = new LocalSinglePlayerController(createSixMaxSoloConfig({ seed: 'npc-runtime-config' }), {
      npcPolicyFactory(runtime) {
        const policy: NpcPolicy = {
          chooseAction(context: NpcDecisionContext) {
            expect(context.config).toEqual(runtime.strategyProfile.policyConfig)
            return { type: 'fold', seatId: context.view.heroSeatId, source: 'npc' }
          },
        }
        created.push({
          seatId: runtime.seatId,
          npcId: runtime.definition.id,
          strategyProfileId: runtime.strategyProfile.id,
          policy,
        })
        return policy
      },
    })

    expect(controller.getSnapshot().publicView.seats.map((seat) => seat.name)).toEqual([
      'You',
      'Maven',
      'Rook',
      'Quinn',
      'Sol',
      'Vega',
    ])
    expect(created.map((entry) => entry.seatId)).toEqual(['npc-1', 'npc-2', 'npc-3', 'npc-4', 'npc-5'])
    expect(new Set(created.map((entry) => entry.policy)).size).toBe(created.length)
    expect(new Set(created.map((entry) => entry.strategyProfileId)).size).toBeGreaterThan(1)
    expect(created.find((entry) => entry.seatId === 'npc-2')?.npcId).toBe('npc-rook')
  })
})
