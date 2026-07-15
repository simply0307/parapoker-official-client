import { describe, expect, it } from 'vitest'
import {
  createGameBlueprint,
  gameBlueprintToControllerConfig,
  npcLineupForBlueprint,
} from '../../src/game-config/gameBlueprint'

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
      { seatId: 'npc-1', kind: 'npc', npcDefinitionId: 'npc-vega' },
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
})
