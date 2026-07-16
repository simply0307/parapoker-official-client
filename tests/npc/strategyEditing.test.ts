import { describe, expect, it } from 'vitest'
import {
  createStrategyProfileVersionDraft,
  updatePreflopHandActionFrequency,
} from '../../src/npc/strategyEditing'
import { simulatePostflopDefenseScenario } from '../../src/npc/npcScenarioSimulator'
import { LOCAL_NPC_STRATEGY_PROFILES } from '../../src/npc/roster'

describe('NPC strategy editing foundation', () => {
  it('creates an independent immutable next-version draft', () => {
    const source = structuredClone(LOCAL_NPC_STRATEGY_PROFILES[0])
    const draft = createStrategyProfileVersionDraft(source)

    expect(draft.id).toBe('strategy-balanced-caller-custom-v5')
    expect(draft.version).toBe(5)
    expect(draft.status).toBe('draft')
    expect(draft.preflopStrategy?.version).toBe((source.preflopStrategy?.version ?? 0) + 1)
    expect(draft.postflopStrategy?.version).toBe((source.postflopStrategy?.version ?? 0) + 1)

    if (!draft.postflopStrategy?.defense) {
      throw new Error('Expected postflop defense configuration.')
    }
    draft.postflopStrategy.defense.foldBias = 0.25
    expect(source.postflopStrategy?.defense?.foldBias).not.toBe(0.25)
  })

  it('updates one preflop action while keeping the hand mix normalized', () => {
    const source = structuredClone(LOCAL_NPC_STRATEGY_PROFILES[0])
    const strategy = source.preflopStrategy
    if (!strategy) {
      throw new Error('Expected a preflop strategy.')
    }
    const node = strategy.nodes[0]
    const updated = updatePreflopHandActionFrequency(strategy, node.id, 'AA', 'raise', 0.8)
    const mix = updated.nodes[0].hands.AA

    expect(mix.find((entry) => entry.action === 'raise')?.frequency).toBe(0.8)
    expect(mix.reduce((sum, entry) => sum + entry.frequency, 0)).toBeCloseTo(1)
    expect(strategy.nodes[0].hands.AA).not.toEqual(mix)
  })

  it('simulates the same profile and scenario deterministically with an inspectable trace', () => {
    const profile = LOCAL_NPC_STRATEGY_PROFILES[0]
    const scenario = {
      potBeforeWager: 100,
      wager: 50,
      heroStack: 200,
      madeStrength: 0.4,
      draw: 'none' as const,
      boardTexture: 'dry' as const,
      heroPosition: 'BB' as const,
      opponentCount: 1,
      heroRangeTop: 0.3,
      opponentRangeTop: 0.3,
      roll: 0.55,
    }

    const first = simulatePostflopDefenseScenario(profile, scenario)
    const second = simulatePostflopDefenseScenario(profile, scenario)

    expect(first).toEqual(second)
    expect(first.ok).toBe(true)
    if (first.ok) {
      expect(first.decision.metrics).toEqual(expect.objectContaining({
        minimumDefenseFrequency: 2 / 3,
        potOdds: 0.25,
      }))
      expect(first.decision.roll).toBe(0.55)
      expect(JSON.stringify(first)).not.toContain('deck')
      expect(JSON.stringify(first)).not.toContain('rngState')
    }
  })

  it('shows profile defense customization changing the same simulated decision', () => {
    const sticky = createStrategyProfileVersionDraft(LOCAL_NPC_STRATEGY_PROFILES[0], {
      id: 'sticky-admin-v5',
    })
    const cautious = createStrategyProfileVersionDraft(LOCAL_NPC_STRATEGY_PROFILES[0], {
      id: 'cautious-admin-v5',
    })
    if (!sticky.postflopStrategy?.defense || !cautious.postflopStrategy?.defense) {
      throw new Error('Expected postflop defense configurations.')
    }
    sticky.postflopStrategy.defense.foldBias = -0.25
    cautious.postflopStrategy.defense.foldBias = 0.25
    const scenario = {
      potBeforeWager: 100,
      wager: 50,
      heroStack: 200,
      madeStrength: 0.4,
      draw: 'none' as const,
      boardTexture: 'dry' as const,
      heroPosition: 'BB' as const,
      opponentCount: 1,
      heroRangeTop: 0.3,
      opponentRangeTop: 0.3,
      roll: 0.55,
    }

    const stickyResult = simulatePostflopDefenseScenario(sticky, scenario)
    const cautiousResult = simulatePostflopDefenseScenario(cautious, scenario)

    expect(stickyResult.ok && stickyResult.decision.command.type).toBe('call')
    expect(cautiousResult.ok && cautiousResult.decision.command.type).toBe('fold')
  })
})
