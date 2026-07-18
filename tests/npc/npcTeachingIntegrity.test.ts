import { describe, expect, it } from 'vitest'
import { traceContainsRestrictedState } from '../../src/npc/npcDecisionTrace'
import { LOCAL_NPC_DEFINITIONS, LOCAL_NPC_STRATEGY_PROFILES } from '../../src/npc/roster'
import {
  createSixMaxSoloConfig,
  LocalSinglePlayerController,
  type LocalSinglePlayerTransition,
} from '../../src/table-controllers/local-single-player/LocalSinglePlayerController'
import type { EngineCommand, LegalAction } from '../../src/poker-engine'

describe('NPC teaching strategy live-path integrity', () => {
  it('reproduces controller decisions and emits a valid privacy-bounded trace for every command', () => {
    const first = runControllerTraces('teaching-live-sequence')
    const second = runControllerTraces('teaching-live-sequence')

    expect(first.length).toBeGreaterThan(20)
    expect(first).toEqual(second)
    expect(first.every((trace) => trace.schemaVersion === 'npc-decision-trace-v1')).toBe(true)
    expect(first.every((trace) => trace.consideredActions.includes(trace.selectedAction))).toBe(true)
    expect(first.every((trace) => !traceContainsRestrictedState(trace))).toBe(true)
    expect(first.every((trace) => trace.strategyProfileVersion > 0 && trace.reasonCode.length > 0)).toBe(true)
  })

  it('pins the strategy identity and teaching tags when the controller is created', () => {
    const profile = structuredClone(LOCAL_NPC_STRATEGY_PROFILES[0])
    const definition = {
      ...structuredClone(LOCAL_NPC_DEFINITIONS[0]),
      strategyProfileId: profile.id,
    }
    const originalVersion = profile.version
    const originalTags = [
      ...(profile.teaching?.conceptTags ?? []),
      ...(profile.teaching?.intendedTendencies.map((tendency) => tendency.id) ?? []),
    ]
    const controller = new LocalSinglePlayerController({ seed: 'pinned-teaching-profile' }, {
      tableIdentity: { matchId: 'pinned-profile-match', tableId: 'pinned-profile-table' },
      npcLineup: [{ seatId: 'npc-1', npcDefinitionId: definition.id }],
      npcDefinitions: [definition],
      npcStrategyProfiles: [profile],
    })

    profile.version = 999
    profile.teaching = {
      teachingObjective: 'Mutated after table creation.',
      conceptTags: ['mutated'],
      intendedTendencies: [{ id: 'overbluffs-river' }],
      intentionallyExploitable: true,
    }
    const transition = controller.submitHumanAction(humanCommand(controller.getSnapshot().heroView.legalActions))

    expect(transition.npcDecisionTraces.length).toBeGreaterThan(0)
    expect(transition.npcDecisionTraces.every((trace) => trace.strategyProfileVersion === originalVersion)).toBe(true)
    expect(transition.npcDecisionTraces.every((trace) => trace.teachingTags.join('|') === originalTags.join('|'))).toBe(true)
    expect(transition.npcDecisionTraces.every((trace) => !trace.teachingTags.includes('mutated'))).toBe(true)
  })

  it('marks explicit coverage gaps as fallback instead of disguising the source', () => {
    const profile = structuredClone(LOCAL_NPC_STRATEGY_PROFILES[0])
    profile.id = 'strategy-fallback-coverage-v1'
    profile.version = 1
    delete profile.preflopStrategy
    delete profile.postflopStrategy
    const definition = {
      ...structuredClone(LOCAL_NPC_DEFINITIONS[0]),
      strategyProfileId: profile.id,
    }
    const controller = new LocalSinglePlayerController({ seed: 'teaching-fallback-source' }, {
      tableIdentity: { matchId: 'fallback-match', tableId: 'fallback-table' },
      npcLineup: [{ seatId: 'npc-1', npcDefinitionId: definition.id }],
      npcDefinitions: [definition],
      npcStrategyProfiles: [profile],
    })
    const transition = controller.submitHumanAction(humanCommand(controller.getSnapshot().heroView.legalActions))

    expect(transition.npcDecisionTraces).toEqual(expect.arrayContaining([
      expect.objectContaining({ decisionSource: 'legacy-fallback' }),
    ]))
  })
})

function runControllerTraces(seed: string) {
  const controller = new LocalSinglePlayerController(createSixMaxSoloConfig({
    seed,
    startingStack: 80,
  }), { tableIdentity: { matchId: seed, tableId: `${seed}:table` } })
  const traces = [...controller.consumeInitialTransition().npcDecisionTraces]
  let safety = 0

  while (traces.length < 30 && controller.getSnapshot().canonicalStatus !== 'complete') {
    safety += 1
    if (safety > 400) throw new Error('Teaching trace simulation exceeded its safety limit.')
    const snapshot = controller.getSnapshot()
    const transition = snapshot.canonicalStatus === 'handInProgress' &&
        snapshot.heroView.pendingSeatId === snapshot.heroView.heroSeatId
      ? controller.submitHumanAction(humanCommand(snapshot.heroView.legalActions))
      : controller.startNextHand()
    record(transition, traces)
  }
  return traces
}

function record(transition: LocalSinglePlayerTransition, traces: LocalSinglePlayerTransition['npcDecisionTraces']): void {
  traces.push(...transition.npcDecisionTraces)
}

function humanCommand(actions: LegalAction[]): Omit<EngineCommand, 'seatId' | 'source'> {
  if (actions.some((action) => action.type === 'check')) return { type: 'check' }
  if (actions.some((action) => action.type === 'call')) return { type: 'call' }
  if (actions.some((action) => action.type === 'fold')) return { type: 'fold' }
  return { type: 'allIn' }
}
