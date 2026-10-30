// TheSkyBlessing の api:damage/modifier と api:damage/ の計算を写す。
// 写した元: TheSkyBlessing/data/api/functions/damage/ と api:damage/core/modify_damage.m。
// 'current' は 95528d1b2、'pr1635' は ProjectTSB/TheSkyBlessing#1635 の 0ee4f16dc。

import { mobDefenseValues, playerValues, toModifiers, type Buff, type ModifierKey, type Modifiers, type ValueCalc } from './attributes.ts'
import { INT_MAX, add, attributeGet, asTag, dataGet, div, max, min, mod, mul, storeDouble, sub, type NumberTag } from './mc.ts'

export type { ModifierKey, Modifiers } from './attributes.ts'

export type CalcMode = 'current' | 'pr1635'
export type AttackType = 'Physical' | 'Magic'
export type ElementType = 'None' | 'Fire' | 'Water' | 'Thunder'

export type ReduceEnchantmentId =
  | 'minecraft:fire_protection'
  | 'minecraft:blast_protection'
  | 'minecraft:projectile_protection'
  | 'minecraft:feather_falling'
  | (string & {})

export interface Bypass {
  modifier: boolean
  armorDefense: boolean
  toughness: boolean
  enchantments: boolean
  resistance: boolean
  difficulty: boolean
}

/** attack は Attributes.Default（普通は 1）。buffs が無ければ api:modifier/<属性>/get で取った値を入れてもよい。 */
export type Attacker =
  | { kind: 'player'; attack: Modifiers; buffs?: Buff[] }
  | { kind: 'mob' }

/** プレイヤーの defense は attack と同じ。Mob の resist は register の Resist（Base は 1f に上書きされる）。 */
export type Target =
  | { kind: 'player'; defense: Modifiers; buffs?: Buff[] }
  | { kind: 'mob'; resist: Omit<Modifiers, 'Base'>; resistTag: NumberTag; buffs?: Buff[] }

export interface DamageInput {
  damage: number
  damageTag: NumberTag
  attackType: AttackType
  elementType: ElementType
  fixedDamage: boolean
  bypass: Bypass
  attacker: Attacker
  target: Target
  /** generic.armor の値（0〜30） */
  armor: number
  /** generic.armor_toughness の値（0〜20） */
  toughness: number
  /** 耐性エフェクトの Lv（amplifier + 1）。0 は無し */
  resistanceLevel: number
  /** 防具 4 部位の Protection のレベルの合計 */
  protectionLevels: number
  reduceEnchantment: { id: ReduceEnchantmentId; levels: number; modifier?: number } | null
  /** 1: Normal、2: Hard、3: Blessless */
  difficulty: number
}

export interface ModifierCalc {
  base: number
  first: number
  second: number
  /** 下限を掛ける前の倍率（100 倍） */
  raw: number
  /** 難易度による下限（100 倍） */
  lowerBound: number
  /** 掛けた倍率（100 倍） */
  applied: number
}

export type Step =
  | { kind: 'input'; tag: NumberTag; stored: number }
  | { kind: 'attackModifier'; skip: 'mobAttacker' | 'bypass' | null; calc: ModifierCalc | null; limited: boolean; after: number }
  | { kind: 'armor'; skip: boolean; calcCapped: boolean; calcLimitE2: number; defensePoints: number; toughness: number; beforeE2: number; afterE4: number }
  | { kind: 'resistance'; skip: 'bypass' | 'none' | null; level: number; afterE4: number }
  | { kind: 'enchantment'; skip: 'bypass' | 'none' | null; epf: number; protection: number; reduceLevels: number | null; coefficient: number; afterE4: number }
  | { kind: 'defenseModifier'; skip: 'bypass' | null; calc: ModifierCalc | null; limited: boolean; afterE2: number }
  | { kind: 'cap'; capped: boolean; limitE2: number; afterE2: number }
  | { kind: 'difficulty'; skip: 'mobTarget' | 'bypass' | null; factor: number; afterE2: number }
  | { kind: 'fluctuation'; skip: 'mobTarget' | null; afterE2: number }

export interface DamageResult {
  mode: CalcMode
  bypass: Bypass
  /** 攻撃元の Attributes.Value.Attack（攻撃元が Mob なら null） */
  attackValues: ValueCalc[] | null
  /** 対象の Attributes.Value.Defense */
  defenseValues: ValueCalc[]
  steps: Step[]
  /** 体力から引かれる量（100 倍の整数） */
  finalE2: number
  final: number
}

interface Limits {
  /** api:damage/core/calc/ が防具の計算の前に止める値 */
  calcE2: number
  /** 最終の上限 */
  damageE2: number
}

export const LIMITS: Record<CalcMode, Limits> = {
  current: { calcE2: 2147483, damageE2: 999990 },
  pr1635: { calcE2: 21474836, damageE2: 9999990 },
}

/** 'current' の difficulty_modifier が掛ける上限。最終の上限より後なので届かない */
const PLAYER_DAMAGE_LIMIT_E2 = 999990000

function effectiveBypass(input: DamageInput): Bypass {
  if (!input.fixedDamage) return input.bypass
  return { modifier: true, armorDefense: true, toughness: true, enchantments: true, resistance: true, difficulty: true }
}

/** api:damage/core/modify_damage.m の補正値の計算。values は Attributes.Value の値。 */
export function modifierOf(values: Modifiers, attackType: AttackType, elementType: ElementType, difficulty: number): ModifierCalc {
  const e2 = (key: ModifierKey) => {
    const value = values[key]
    return value === undefined ? 100 : dataGet(value, 100)
  }
  const base = e2('Base')
  const first = e2(attackType)
  const second = elementType === 'None' ? 100 : e2(elementType)
  const sum = sub(add(first, second), 100)
  const raw = div(mul(base, sum), 100)
  const lowerBound = max(add(mul(dataGet(difficulty, 10), -1), 45), 0)
  return { base, first, second, raw, lowerBound, applied: max(raw, lowerBound) }
}

/** modify_damage.m の「補正」。PR #1635 は掛ける前に、int の上限 ÷ 倍率で Damage を止める。 */
function applyModifier(damageE2: number, applied: number, mode: CalcMode): { damage: number; limited: boolean } {
  if (mode === 'pr1635') {
    const limit = div(INT_MAX, applied)
    if (damageE2 > limit) return { damage: mul(limit, applied), limited: true }
  }
  return { damage: mul(damageE2, applied), limited: false }
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi)
}

const REDUCE_COEFFICIENT: Record<string, number> = {
  'minecraft:fire_protection': 2,
  'minecraft:blast_protection': 2,
  'minecraft:projectile_protection': 2,
  'minecraft:feather_falling': 3,
}

export function reduceCoefficient(reduce: NonNullable<DamageInput['reduceEnchantment']>): number {
  return reduce.modifier ?? REDUCE_COEFFICIENT[reduce.id] ?? 1
}

/** api:damage/core/calc/defense */
function armorReduction(damage: number, defensePoints: number, toughness: number, mode: CalcMode): number {
  if (mode === 'pr1635') {
    const a = div(defensePoints, 5)
    const b1 = add(mul(toughness, 25), 20000)
    const b2 = add(mul(div(damage, b1), 10000), div(mul(mod(damage, b1), 10000), b1))
    const b = sub(defensePoints, b2)
    const d = sub(10000, mul(min(max(a, b), 2000), 4))
    return add(mul(div(damage, 100), d), div(mul(mod(damage, 100), d), 100))
  }
  const big = damage >= 100000
  const a = div(mul(defensePoints, 20), 100)
  let b3 = mul(toughness, 25)
  b3 = big ? add(div(b3, 100), 200) : add(b3, 20000)
  const b2 = div(big ? mul(damage, 100) : mul(damage, 10000), b3)
  const b = sub(defensePoints, b2)
  const c = mul(min(max(a, b), 2000), 4)
  let d = sub(10000, c)
  if (big) d = div(d, 10)
  const e = mul(damage, d)
  return big ? div(e, 10) : div(e, 100)
}

/** api:damage/core/calc/resistance */
function resistanceReduction(damage: number, level: number, mode: CalcMode): number {
  const multiplier = sub(10, min(level, 10))
  if (mode === 'pr1635') return add(mul(div(damage, 10), multiplier), div(mul(mod(damage, 10), multiplier), 10))
  return div(mul(damage, multiplier), 10)
}

/** api:damage/core/calc/enchantment */
function enchantmentReduction(damage: number, epf: number, mode: CalcMode): number {
  const f = sub(100, mul(min(epf, 20), 2))
  if (mode === 'pr1635') return add(mul(div(damage, 100), f), div(mul(mod(damage, 100), f), 100))
  let g = damage
  if (damage >= 10000000) g = div(g, 10)
  g = mul(g, f)
  return damage <= 9999999 ? div(g, 100) : div(g, 10)
}

export function calculateDamage(input: DamageInput, mode: CalcMode): DamageResult {
  const bypass = effectiveBypass(input)
  const limits = LIMITS[mode]
  const steps: Step[] = []
  const attackValues = input.attacker.kind === 'player' ? playerValues(input.attacker.attack, input.attacker.buffs ?? [], 'attack') : null
  const target = input.target
  const defenseValues = target.kind === 'player'
    ? playerValues(target.defense, target.buffs ?? [], 'defense')
    : mobDefenseValues(target.resist, target.resistTag, target.buffs ?? [])

  // api:damage/modifier
  let argument = asTag(input.damage, input.damageTag)
  steps.push({ kind: 'input', tag: input.damageTag, stored: argument })
  if (attackValues === null) {
    steps.push({ kind: 'attackModifier', skip: 'mobAttacker', calc: null, limited: false, after: argument })
  } else if (bypass.modifier) {
    steps.push({ kind: 'attackModifier', skip: 'bypass', calc: null, limited: false, after: argument })
  } else {
    const calc = modifierOf(toModifiers(attackValues), input.attackType, input.elementType, input.difficulty)
    const applied = applyModifier(dataGet(argument, 100), calc.applied, mode)
    argument = storeDouble(applied.damage, 0.0001)
    steps.push({ kind: 'attackModifier', skip: null, calc, limited: applied.limited, after: argument })
  }

  // api:damage/core/get_status/
  let damage = dataGet(argument, 100)
  const defensePoints = bypass.armorDefense ? 0 : attributeGet(clamp(input.armor, 0, 30), 100)
  const toughness = bypass.toughness ? 0 : attributeGet(clamp(input.toughness, 0, 20), 100)
  const reduce = input.reduceEnchantment
  const reducePoints = reduce ? mul(reduce.levels, reduceCoefficient(reduce)) : 0
  const epf = bypass.enchantments ? 0 : add(input.protectionLevels, reducePoints)
  const resistance = bypass.resistance ? 0 : input.resistanceLevel

  // api:damage/core/calc/
  const calcCapped = damage >= limits.calcE2
  if (calcCapped) damage = limits.calcE2
  const armorSkip = defensePoints === 0 && toughness === 0
  const beforeArmor = damage
  damage = armorSkip ? mul(damage, 100) : armorReduction(damage, defensePoints, toughness, mode)
  steps.push({ kind: 'armor', skip: armorSkip, calcCapped, calcLimitE2: limits.calcE2, defensePoints, toughness, beforeE2: beforeArmor, afterE4: damage })

  if (resistance >= 1) {
    damage = resistanceReduction(damage, resistance, mode)
    steps.push({ kind: 'resistance', skip: null, level: resistance, afterE4: damage })
  } else {
    steps.push({ kind: 'resistance', skip: bypass.resistance ? 'bypass' : 'none', level: resistance, afterE4: damage })
  }

  const enchantmentStep = { protection: input.protectionLevels, reduceLevels: reduce?.levels ?? null, coefficient: reduce ? reduceCoefficient(reduce) : 0 }
  if (epf >= 1) {
    damage = enchantmentReduction(damage, epf, mode)
    steps.push({ kind: 'enchantment', skip: null, epf, ...enchantmentStep, afterE4: damage })
  } else {
    steps.push({ kind: 'enchantment', skip: bypass.enchantments ? 'bypass' : 'none', epf, ...enchantmentStep, afterE4: damage })
  }

  // api:damage/core/attack
  if (bypass.modifier) {
    damage = div(damage, 100)
    steps.push({ kind: 'defenseModifier', skip: 'bypass', calc: null, limited: false, afterE2: damage })
  } else {
    const calc = modifierOf(toModifiers(defenseValues), input.attackType, input.elementType, input.difficulty)
    const applied = applyModifier(dataGet(storeDouble(damage, 0.0001), 100), calc.applied, mode)
    damage = dataGet(storeDouble(applied.damage, 0.0001), 100)
    steps.push({ kind: 'defenseModifier', skip: null, calc, limited: applied.limited, afterE2: damage })
  }

  const cap = () => {
    const capped = damage >= limits.damageE2
    if (capped) damage = limits.damageE2
    steps.push({ kind: 'cap', capped, limitE2: limits.damageE2, afterE2: damage })
  }

  // 'current' は api:damage/core/attack で上限を掛けてから体力に適用する。
  // 'pr1635' は api:damage/core/health_subtract/ の中で、プレイヤーなら難易度補正の後に掛ける。
  if (mode === 'current') cap()

  // api:damage/core/health_subtract/player/difficulty_modifier
  if (target.kind === 'mob') {
    steps.push({ kind: 'difficulty', skip: 'mobTarget', factor: 10, afterE2: damage })
  } else if (bypass.difficulty) {
    steps.push({ kind: 'difficulty', skip: 'bypass', factor: 10, afterE2: damage })
  } else {
    const factor = add(dataGet(input.difficulty, 2), 6)
    damage = div(mul(damage, factor), 10)
    if (mode === 'current') damage = min(damage, PLAYER_DAMAGE_LIMIT_E2)
    steps.push({ kind: 'difficulty', skip: null, factor, afterE2: damage })
  }

  if (mode === 'pr1635') cap()

  // api:damage/core/health_subtract/player/ → lib:score_to_health_wrapper/fluctuation
  if (target.kind === 'mob') {
    steps.push({ kind: 'fluctuation', skip: 'mobTarget', afterE2: damage })
  } else {
    damage = -dataGet(storeDouble(damage, -0.01), 100)
    steps.push({ kind: 'fluctuation', skip: null, afterE2: damage })
  }

  return { mode, bypass, attackValues, defenseValues, steps, finalE2: damage, final: storeDouble(damage, 0.01) }
}
