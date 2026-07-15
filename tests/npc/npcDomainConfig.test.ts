import { describe, expect, it } from 'vitest'
import { createNpcDecisionContext } from '../../src/npc/basicNpc'
import {
  DEFAULT_HEADS_UP_NPC_LINEUP,
  DEFAULT_SIX_MAX_NPC_LINEUP,
  LOCAL_NPC_DEFINITIONS,
  LOCAL_NPC_STRATEGY_PROFILES,
  localNpcDefinitionForSeat,
  localNpcStrategyProfile,
} from '../../src/npc/roster'
import { createRng } from '../../src/shared/rng'
import type { LegalAction, PrivateSeatView } from '../../src/poker-engine'

describe('NPC domain configuration', () => {
  it('keeps NPC identity separate from versioned strategy profiles', () => {
    expect(LOCAL_NPC_DEFINITIONS).toHaveLength(5)
    expect(new Set(LOCAL_NPC_DEFINITIONS.map((npc) => npc.id)).size).toBe(LOCAL_NPC_DEFINITIONS.length)
    expect(new Set(LOCAL_NPC_STRATEGY_PROFILES.map((profile) => profile.id)).size).toBe(
      LOCAL_NPC_STRATEGY_PROFILES.length,
    )

    for (const npc of LOCAL_NPC_DEFINITIONS) {
      expect(npc).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          name: expect.any(String),
          archetypeLabel: expect.any(String),
          strategyProfileId: expect.any(String),
          status: 'active',
        }),
      )
      const profile = localNpcStrategyProfile(npc.strategyProfileId)
      expect(profile).toEqual(expect.objectContaining({ id: npc.strategyProfileId, version: expect.any(Number) }))
      expect(profile?.modules.length).toBeGreaterThan(0)
      expect(profile?.preflopStrategy).toEqual(expect.objectContaining({
        schemaVersion: 'npc-preflop-v1',
        version: expect.any(Number),
      }))
      expect(new Set(profile?.preflopStrategy?.nodes.flatMap((node) => node.formats))).toEqual(
        new Set(['heads-up', 'six-max']),
      )
      expect(profile?.postflopStrategy).toEqual(expect.objectContaining({
        schemaVersion: 'npc-postflop-v1',
        version: expect.any(Number),
      }))
    }
  })

  it('uses default lineups to map stable NPC identities onto table seats', () => {
    expect(DEFAULT_HEADS_UP_NPC_LINEUP).toEqual([{ seatId: 'npc-1', npcDefinitionId: 'npc-maven' }])
    expect(DEFAULT_SIX_MAX_NPC_LINEUP.map((assignment) => assignment.seatId)).toEqual([
      'npc-1',
      'npc-2',
      'npc-3',
      'npc-4',
      'npc-5',
    ])

    expect(localNpcDefinitionForSeat('npc-1')?.id).toBe('npc-maven')
    expect(localNpcDefinitionForSeat('npc-5')?.id).toBe('npc-vega')
  })

  it('lets archetypes alter strategy through profile-owned policy config', () => {
    const maven = localNpcStrategyProfile('strategy-balanced-caller-v4')
    const rook = localNpcStrategyProfile('strategy-pressure-raiser-v4')
    const quinn = localNpcStrategyProfile('strategy-board-watcher-v4')

    expect(maven?.policyConfig).not.toEqual(rook?.policyConfig)
    expect(quinn?.policyConfig).not.toEqual(rook?.policyConfig)
    expect(rook?.policyConfig.preflopAggression).toBeGreaterThan(maven?.policyConfig.preflopAggression ?? 0)
    expect(quinn?.policyConfig.postflopAggression).toBeGreaterThan(maven?.policyConfig.postflopAggression ?? 0)
  })

  it('builds an NPC decision context from projections, legal actions, config, read-only memory, and RNG', () => {
    const legalActions: LegalAction[] = [{ type: 'check' }, { type: 'bet', min: 2, max: 20 }]
    const view = {
      heroSeatId: 'npc-1',
      legalActions,
      holeCards: [],
      communityCards: [],
      seats: [],
      street: 'preflop',
      pot: 0,
      currentBet: 0,
      minRaise: 2,
      events: [],
    } as unknown as PrivateSeatView
    const profile = localNpcStrategyProfile('strategy-pressure-raiser-v4')
    const rng = createRng('npc-domain-context')
    const context = createNpcDecisionContext(
      view,
      rng,
      profile?.policyConfig,
      { handsObserved: 12 },
      profile?.preflopStrategy,
    )

    expect(context.view).toBe(view)
    expect(context.legalActions).toBe(legalActions)
    expect(context.config.preflopAggression).toBe(profile?.policyConfig.preflopAggression)
    expect(context.memory).toEqual({ handsObserved: 12 })
    expect(context.rng).toBe(rng)
    expect(context.preflopStrategy?.id).toBe(profile?.preflopStrategy?.id)
  })
})
