import { describe, expect, it } from 'vitest'
import { BasicNpcPolicy } from '../../src/npc/basicNpc'
import { applyAction, createGame, getSeatView, startNextHand } from '../../src/poker-engine'

describe('basic NPC policy', () => {
  it('chooses only a legal shared engine command from its seat projection', () => {
    const started = startNextHand(createGame({ seed: 'npc-legal' }))
    expect(started.ok).toBe(true)
    if (!started.ok) {
      throw new Error(started.error.message)
    }

    const afterHumanCall = applyAction(started.state, { type: 'call', seatId: 'human', source: 'human' })
    expect(afterHumanCall.ok).toBe(true)
    if (!afterHumanCall.ok) {
      throw new Error(afterHumanCall.error.message)
    }

    const view = getSeatView(afterHumanCall.state, 'npc-1')
    const command = new BasicNpcPolicy('npc-test').chooseAction(view)
    const result = applyAction(afterHumanCall.state, command)

    expect(result.ok).toBe(true)
    expect(command.seatId).toBe('npc-1')
    expect(JSON.stringify(view)).not.toContain('deck')
    expect(JSON.stringify(view)).not.toContain('rngState')
  })
})
