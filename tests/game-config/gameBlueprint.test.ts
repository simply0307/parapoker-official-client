import { describe, expect, it } from 'vitest'
import {
  createGameBlueprint,
  gameBlueprintToControllerConfig,
  npcLineupForBlueprint,
  npcStrategyProfilesForBlueprint,
} from '../../src/game-config/gameBlueprint'
import { LOCAL_NPC_DEFINITIONS, LOCAL_NPC_STRATEGY_PROFILES } from '../../src/npc/roster'

describe('game blueprint configuration', () => {
  it('creates a reusable heads-up blueprint with explicit visibility and NPC lineup', () => {
    const blueprint = createGameBlueprint({
      mode: 'heads-up',
      startingStack: 200,
      smallBlind: 1,
      bigBlind: 2,
      seed: 'blueprint-heads-up',
      visibility: 'private',
      npcLineup: [{ seatId: 'npc-1', npcDefinitionId: 'npc-vega' }],
    })

    expect(blueprint).toEqual(
      expect.objectContaining({
        id: 'local-heads-up-blueprint',
        mode: 'heads-up',
        visibility: 'private',
        startingStack: 200,
        seed: 'blueprint-heads-up',
      }),
    )
    expect(blueprint.seats).toEqual([
      { seatId: 'human', kind: 'human', displayName: 'You', playerId: 'local-human' },
      {
        seatId: 'npc-1',
        kind: 'npc',
        npcDefinitionId: 'npc-vega',
        npcStrategyProfileId: 'strategy-value-hunter-v5',
        npcStrategyProfileVersion: 5,
      },
    ])
    expect(npcLineupForBlueprint(blueprint)).toEqual([{ seatId: 'npc-1', npcDefinitionId: 'npc-vega' }])
  })

  it('converts blueprints into engine config without exposing admin-only metadata', () => {
    const config = gameBlueprintToControllerConfig(
      createGameBlueprint({
        mode: 'six-max',
        startingStack: 300,
        smallBlind: 2,
        bigBlind: 4,
        seed: 'blueprint-six-max',
        visibility: 'unlisted',
      }),
    )

    expect(config).toEqual(
      expect.objectContaining({
        startingStack: 300,
        smallBlind: 2,
        bigBlind: 4,
        seed: 'blueprint-six-max',
      }),
    )
    expect(config.seats?.map((seat) => seat.name)).toEqual(['You', 'Maven', 'Rook', 'Quinn', 'Sol', 'Vega'])
    expect(JSON.stringify(config)).not.toContain('visibility')
    expect(JSON.stringify(config)).not.toContain('strategyProfileId')
  })

  it('uses the joined player profile as the human seat identity', () => {
    const blueprint = createGameBlueprint({
      mode: 'heads-up',
      startingStack: 200,
      smallBlind: 1,
      bigBlind: 2,
      seed: 'profile-identity',
      humanPlayer: {
        playerId: 'profile-river-port',
        displayName: 'RiverPort',
      },
    })

    expect(blueprint.seats[0]).toEqual({
      seatId: 'human',
      kind: 'human',
      displayName: 'RiverPort',
      playerId: 'profile-river-port',
    })
    expect(gameBlueprintToControllerConfig(blueprint).seats?.[0].name).toBe('RiverPort')
  })

  it('allows a reusable blueprint to request a random seed when a table opens', () => {
    const blueprint = createGameBlueprint({
      mode: 'heads-up',
      startingStack: 200,
      smallBlind: 1,
      bigBlind: 2,
      seedPolicy: 'random',
    })

    expect(blueprint.seedPolicy).toBe('random')
    expect(blueprint.seed).toBe('')
  })

  it('defaults seedless reusable blueprints to a random seed policy', () => {
    const blueprint = createGameBlueprint({
      mode: 'heads-up',
      startingStack: 200,
      smallBlind: 1,
      bigBlind: 2,
    })

    expect(blueprint.seedPolicy).toBe('random')
    expect(blueprint.seed).toBe('')
  })

  it('pins the selected NPC strategy profile id and version into each NPC seat', () => {
    const profile = structuredClone(LOCAL_NPC_STRATEGY_PROFILES[0])
    profile.id = 'strategy-admin-custom-v5'
    profile.version = 5
    const definition = {
      ...structuredClone(LOCAL_NPC_DEFINITIONS[0]),
      strategyProfileId: profile.id,
    }
    const blueprint = createGameBlueprint({
      mode: 'heads-up',
      startingStack: 200,
      smallBlind: 1,
      bigBlind: 2,
      seed: 'pinned-admin-profile',
      npcLineup: [{ seatId: 'npc-1', npcDefinitionId: definition.id }],
      npcDefinitions: [definition],
      npcStrategyProfiles: [profile],
    })

    expect(blueprint.seats[1]).toEqual(expect.objectContaining({
      npcDefinitionId: definition.id,
      npcStrategyProfileId: profile.id,
      npcStrategyProfileVersion: 5,
    }))
    expect(npcStrategyProfilesForBlueprint(blueprint, [definition], [profile])).toEqual([profile])
  })
})
