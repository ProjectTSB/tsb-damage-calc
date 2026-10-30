import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mobDefenseValues, playerValues, type Buff } from '../src/calc/attributes.ts'
import { calculateDamage, type DamageInput } from '../src/calc/damage.ts'

const resultE3 = (values: ReturnType<typeof playerValues>, key: string) => values.find((v) => v.key === key)?.composition?.resultE3

test('装備のバフ（multiply_base）は足してから 1 回掛ける', () => {
  const buffs: Buff[] = [
    { key: 'Physical', amount: 0.1, operation: 'multiply_base' },
    { key: 'Physical', amount: 0.15, operation: 'multiply_base' },
  ]
  assert.equal(resultE3(playerValues({}, buffs, 'attack'), 'Physical'), 1250)
})

test('エフェクトのバフ（multiply）は 1 つずつ掛ける', () => {
  const effects: Buff[] = [
    { key: 'Physical', amount: 0.1, operation: 'multiply' },
    { key: 'Physical', amount: 0.15, operation: 'multiply' },
  ]
  assert.equal(resultE3(playerValues({}, effects, 'attack'), 'Physical'), 1265)
  const mixed: Buff[] = [
    { key: 'Physical', amount: 0.1, operation: 'multiply_base' },
    { key: 'Physical', amount: 0.15, operation: 'multiply_base' },
    { key: 'Physical', amount: 0.2, operation: 'multiply' },
  ]
  assert.equal(resultE3(playerValues({}, mixed, 'attack'), 'Physical'), 1500)
})

test('同じ補正先に 3 つ以上積むと、multiply はゲームの Modifiers の並びの順に掛かる', () => {
  const buffs: Buff[] = [
    { key: 'Physical', amount: 0.15, operation: 'multiply' },
    { key: 'Physical', amount: 0.35, operation: 'multiply' },
    { key: 'Physical', amount: 0.25, operation: 'multiply_base' },
  ]
  const values = playerValues({}, buffs, 'attack')
  assert.deepEqual(values.find((v) => v.key === 'Physical')?.composition?.multiplyE3, [350, 150])
  assert.equal(resultE3(values, 'Physical'), 1940)
})

test('add は基礎値に足してから倍率を掛ける', () => {
  const buffs: Buff[] = [
    { key: 'Base', amount: 0.2, operation: 'multiply_base' },
    { key: 'Base', amount: 0.3, operation: 'add' },
  ]
  assert.equal(resultE3(playerValues({}, buffs, 'attack'), 'Base'), 1560)
})

test('Defense の寄与は符号が反転し、0.2 で受けるダメージが 0.8 倍になる', () => {
  const values = playerValues({}, [{ key: 'Base', amount: 0.2, operation: 'multiply' }], 'defense')
  assert.equal(resultE3(values, 'Base'), 800)
})

test('Attack の寄与は Amount をそのまま積み、Defense は 1/1000 に直してから積む', () => {
  const attack: Buff[] = [
    { key: 'Magic', amount: 0.2, operation: 'multiply_base' },
    { key: 'Magic', amount: -0.35, operation: 'multiply' },
  ]
  assert.equal(resultE3(playerValues({}, attack, 'attack'), 'Magic'), 780)
  assert.equal(resultE3(playerValues({}, [{ key: 'Base', amount: 0.35, operation: 'multiply' }], 'defense'), 'Base'), 649)
})

test('組み立てた 1.265 はダメージ計算では 1.26 として読まれる', () => {
  const input: DamageInput = {
    damage: 100,
    damageTag: 'double',
    attackType: 'Physical',
    elementType: 'None',
    fixedDamage: false,
    bypass: { modifier: false, armorDefense: false, toughness: false, enchantments: false, resistance: false, difficulty: false },
    attacker: {
      kind: 'player',
      attack: {},
      buffs: [
        { key: 'Physical', amount: 0.1, operation: 'multiply' },
        { key: 'Physical', amount: 0.15, operation: 'multiply' },
      ],
    },
    target: { kind: 'mob', resist: {}, resistTag: 'double' },
    armor: 0,
    toughness: 0,
    resistanceLevel: 0,
    protectionLevels: 0,
    reduceEnchantment: null,
    difficulty: 1,
  }
  assert.equal(calculateDamage(input, 'current').finalE2, 12600)
})

test('装備の multiply_base +0.16 だけだと 1.16 が 1.15 として読まれる', () => {
  const input: DamageInput = {
    damage: 100,
    damageTag: 'double',
    attackType: 'Physical',
    elementType: 'None',
    fixedDamage: false,
    bypass: { modifier: false, armorDefense: false, toughness: false, enchantments: false, resistance: false, difficulty: false },
    attacker: { kind: 'player', attack: {}, buffs: [{ key: 'Base', amount: 0.16, operation: 'multiply_base' }] },
    target: { kind: 'mob', resist: {}, resistTag: 'double' },
    armor: 0,
    toughness: 0,
    resistanceLevel: 0,
    protectionLevels: 0,
    reduceEnchantment: null,
    difficulty: 1,
  }
  assert.equal(calculateDamage(input, 'current').finalE2, 11500)
})

test('Mob の耐性は寄与が無ければ register の値のまま、寄与を積んだ項目だけ 1/1000 に組み立て直す', () => {
  const plain = mobDefenseValues({ Physical: 1.4 }, 'float', [])
  assert.equal(plain.find((v) => v.key === 'Physical')?.value, Math.fround(1.4))
  const buffed = mobDefenseValues({ Physical: 1.4, Fire: 0.7 }, 'float', [{ key: 'Physical', amount: 0, operation: 'multiply' }])
  assert.equal(buffed.find((v) => v.key === 'Physical')?.composition?.resultE3, 1399)
  assert.equal(buffed.find((v) => v.key === 'Fire')?.value, Math.fround(0.7))
  assert.equal(buffed.find((v) => v.key === 'Base')?.value, 1)
})
