import assert from 'node:assert/strict'
import { test } from 'node:test'
import { calculateDamage, type DamageInput, type Step } from '../src/calc/damage.ts'

const noBypass = { modifier: false, armorDefense: false, toughness: false, enchantments: false, resistance: false, difficulty: false }

function input(overrides: Partial<DamageInput>): DamageInput {
  return {
    damage: 10,
    damageTag: 'float',
    attackType: 'Physical',
    elementType: 'None',
    fixedDamage: false,
    bypass: noBypass,
    attacker: { kind: 'player', attack: {} },
    target: { kind: 'mob', resist: {}, resistTag: 'double' },
    armor: 0,
    toughness: 0,
    resistanceLevel: 0,
    protectionLevels: 0,
    reduceEnchantment: null,
    difficulty: 1,
    ...overrides,
  }
}

function step<K extends Step['kind']>(steps: Step[], kind: K): Extract<Step, { kind: K }> {
  const found = steps.find((s) => s.kind === kind)
  assert.ok(found, `${kind} の段が無い`)
  return found as Extract<Step, { kind: K }>
}

test('ダメージ 1000 未満は、どちらのモードでも同じ値になる', () => {
  const cases = [
    input({ damage: 24.5, armor: 15, toughness: 4, resistanceLevel: 1, protectionLevels: 6 }),
    input({ damage: 87.6, elementType: 'Water', attacker: { kind: 'player', attack: { Base: 1.3, Water: 1.2 } }, armor: 12, toughness: 3 }),
    input({ damage: 24.5, attacker: { kind: 'mob' }, target: { kind: 'player', defense: { Base: 0.85 } }, difficulty: 3, armor: 15 }),
  ]
  for (const c of cases) assert.equal(calculateDamage(c, 'pr1635').finalE2, calculateDamage(c, 'current').finalE2)
})

test('PR #1635 では最終の上限が 99999.9 になる', () => {
  const c = input({ damage: 50000, attacker: { kind: 'player', attack: { Base: 3 } } })
  assert.equal(calculateDamage(c, 'current').finalE2, 999990)
  const pr = calculateDamage(c, 'pr1635')
  assert.equal(step(pr.steps, 'armor').calcCapped, false)
  assert.equal(pr.finalE2, 9999990)
})

test('PR #1635 は倍率を掛ける前に、int の上限 ÷ 倍率で Damage を止める', () => {
  const pr = calculateDamage(input({ damage: 300000, attacker: { kind: 'player', attack: { Base: 2 } } }), 'pr1635')
  assert.equal(step(pr.steps, 'attackModifier').limited, true)
  assert.equal(step(pr.steps, 'armor').calcCapped, true)
  assert.equal(pr.finalE2, 9999990)
})

test('PR #1635 はダメージ 1000 以上でも防具とエンチャントを精度を落とさずに計算する', () => {
  const c = input({ damage: 1234.56, damageTag: 'double', armor: 10.12, toughness: 5, protectionLevels: 7 })
  const current = calculateDamage(c, 'current')
  const pr = calculateDamage(c, 'pr1635')
  assert.equal(step(current.steps, 'armor').afterE4, 11345606)
  assert.equal(step(pr.steps, 'armor').afterE4, 11348075)
  assert.equal(step(current.steps, 'enchantment').afterE4, 9757216)
  assert.equal(step(pr.steps, 'enchantment').afterE4, 9759344)
})

test('PR #1635 はプレイヤーへの上限を難易度補正の後に掛ける', () => {
  const c = input({ damage: 90000, attacker: { kind: 'mob' }, target: { kind: 'player', defense: {} }, difficulty: 3 })
  assert.equal(calculateDamage(c, 'current').finalE2, 1199988)
  const pr = calculateDamage(c, 'pr1635')
  const kinds = pr.steps.map((s) => s.kind)
  assert.ok(kinds.indexOf('difficulty') < kinds.indexOf('cap'))
  assert.equal(step(pr.steps, 'difficulty').afterE2, 10800000)
  assert.equal(step(pr.steps, 'cap').afterE2, 9999990)
})
