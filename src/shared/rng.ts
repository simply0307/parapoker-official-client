export interface Rng {
  next(): number
  state(): number
}

const MODULUS = 2_147_483_647
const MULTIPLIER = 48_271

export function hashSeed(seed: string | number): number {
  if (typeof seed === 'number') {
    return normalizeSeed(seed)
  }

  let value = 0
  for (let index = 0; index < seed.length; index += 1) {
    value = (value * 31 + seed.charCodeAt(index)) % MODULUS
  }
  return normalizeSeed(value)
}

export function normalizeSeed(seed: number): number {
  const normalized = Math.abs(Math.trunc(seed)) % MODULUS
  return normalized === 0 ? 1 : normalized
}

export class SeededRng implements Rng {
  private current: number

  constructor(seed: string | number) {
    this.current = hashSeed(seed)
  }

  next(): number {
    this.current = (this.current * MULTIPLIER) % MODULUS
    return this.current / MODULUS
  }

  state(): number {
    return this.current
  }
}

export function createRng(seed: string | number): SeededRng {
  return new SeededRng(seed)
}
