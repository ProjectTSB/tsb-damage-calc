// TheSkyBlessing の api:modifier が Attributes.Value を組み立てる計算を写す。
// 写した元: api:modifier/core/common/update_modifier/ と api:modifier/core/<attack|defense>/*/add（95528d1b2）。

import { add, asTag, dataGet, div, mul, storeDouble, type NumberTag } from './mc.ts'

export type ModifierKey = 'Base' | 'Physical' | 'Magic' | 'Fire' | 'Water' | 'Thunder'

/** Attributes.Value.Attack / Defense。未設定の項目は undefined（計算では 1 として扱われる）。 */
export type Modifiers = Partial<Record<ModifierKey, number>>

export const MODIFIER_KEYS: ModifierKey[] = ['Base', 'Physical', 'Magic', 'Fire', 'Water', 'Thunder']

export type Operation = 'add' | 'multiply_base' | 'multiply'
export type Side = 'attack' | 'defense'

/** api:modifier/<side>/<key>/add に渡す 1 つの寄与。amount は Argument.Amount の値。 */
export interface Buff {
  key: ModifierKey
  amount: number
  operation: Operation
}

export interface Composition {
  /** Attributes.Default の 1000 倍 */
  defaultE3: number
  addE3: number
  multiplyBaseE3: number
  /** multiply の寄与の 1000 倍。掛ける順 */
  multiplyE3: number[]
  resultE3: number
}

export interface ValueCalc {
  key: ModifierKey
  defaultValue: number
  /** 寄与から組み立て直さなかった項目は null（Default がそのまま Value に入っている） */
  composition: Composition | null
  /** Attributes.Value に入る値 */
  value: number
}

/**
 * api:modifier/core/<side>/<key>/add が Modifiers に積む Amount。
 * Attack は Argument.Amount をそのまま積み、Defense は 1000 倍の整数にして符号を反転して積む。
 */
export function storedAmount(amount: number, side: Side): number {
  return side === 'defense' ? storeDouble(dataGet(amount, 1000), -0.001) : amount
}

/** update_modifier/ が読む寄与の 1000 倍。 */
export function amountE3(amount: number, side: Side): number {
  return dataGet(storedAmount(amount, side), 1000)
}

/** add を items の順に呼んだときの Modifiers の並び。remove_modifier が add のたびに配列を逆順に詰め直す。 */
function modifiersOrder<T>(items: T[]): T[] {
  let order: T[] = []
  for (const item of items) order = [...[...order].reverse(), item]
  return order
}

/** api:modifier/core/common/update_modifier/。buffs は add を呼ぶ順で、multiply は Modifiers の並びの順に掛かる。 */
export function compose(defaultE3: number, buffs: Buff[], side: Side): Composition {
  let addE3 = 0
  let multiplyBaseE3 = 0
  const multiplyE3: number[] = []
  for (const buff of modifiersOrder(buffs)) {
    const e3 = amountE3(buff.amount, side)
    if (buff.operation === 'add') addE3 = add(addE3, e3)
    else if (buff.operation === 'multiply_base') multiplyBaseE3 = add(multiplyBaseE3, e3)
    else multiplyE3.push(e3)
  }
  let resultE3 = add(defaultE3, addE3)
  resultE3 = div(mul(resultE3, add(multiplyBaseE3, 1000)), 1000)
  for (const e3 of multiplyE3) resultE3 = div(mul(resultE3, add(e3, 1000)), 1000)
  return { defaultE3, addE3, multiplyBaseE3, multiplyE3, resultE3 }
}

/**
 * プレイヤーの Attributes.Value。プレイヤーの値はいつも api:modifier が組み立てた 1/1000 の値なので、
 * 基礎値（普通は 1）も 1/1000 の値として読む。
 */
export function playerValues(base: Modifiers, buffs: Buff[], side: Side): ValueCalc[] {
  return MODIFIER_KEYS.map((key) => {
    const defaultValue = base[key] ?? 1
    const composition = compose(Math.round(defaultValue * 1000), buffs.filter((buff) => buff.key === key), side)
    return { key, defaultValue, composition, value: storeDouble(composition.resultE3, 0.001) }
  })
}

/**
 * Mob の Attributes.Value.Defense。召喚時に register の Resist がそのまま入り（未指定と Base は 1f）、
 * 寄与を積んだ項目だけ 1/1000 の値に組み立て直される。
 */
export function mobDefenseValues(resist: Omit<Modifiers, 'Base'>, resistTag: NumberTag, buffs: Buff[]): ValueCalc[] {
  return MODIFIER_KEYS.map((key) => {
    const written = key === 'Base' ? undefined : resist[key]
    const defaultValue = written === undefined ? 1 : asTag(written, resistTag)
    const own = buffs.filter((buff) => buff.key === key)
    if (own.length === 0) return { key, defaultValue, composition: null, value: defaultValue }
    const composition = compose(dataGet(defaultValue, 1000), own, 'defense')
    return { key, defaultValue, composition, value: storeDouble(composition.resultE3, 0.001) }
  })
}

export function toModifiers(values: ValueCalc[]): Modifiers {
  return Object.fromEntries(values.map((v) => [v.key, v.value]))
}
