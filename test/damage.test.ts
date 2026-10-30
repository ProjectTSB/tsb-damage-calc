import assert from 'node:assert/strict'
import { test } from 'node:test'
import { calculateDamage, type DamageInput } from '../src/calc/damage.ts'

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

const final = (overrides: Partial<DamageInput>) => calculateDamage(input(overrides), 'current').finalE2

test('補正も守りも無ければ Damage がそのまま通る', () => {
  assert.equal(final({}), 1000)
})

test('攻撃側の倍率は Base × (第一属性 + 第二属性 − 1)', () => {
  assert.equal(final({ attacker: { kind: 'player', attack: { Base: 1.2 } } }), 1200)
  assert.equal(final({ attacker: { kind: 'player', attack: { Physical: 1.5, Fire: 1.2 } }, elementType: 'Fire' }), 1700)
  assert.equal(final({ attacker: { kind: 'player', attack: { Magic: 2 } }, attackType: 'Magic' }), 2000)
})

test('倍率は 0.45 − 0.10 × Difficulty を下回らない', () => {
  assert.equal(final({ attacker: { kind: 'player', attack: { Base: 0.1 } } }), 350)
  assert.equal(final({ attacker: { kind: 'player', attack: { Base: 0.1 } }, difficulty: 3 }), 150)
})

test('防具値 20・防具強度 0 で 10 ダメージは Vanilla の式どおり 4.0', () => {
  assert.equal(final({ armor: 20 }), 400)
})

test('防具強度は貫通を抑える（防具値 20・強度 8 で 10 ダメージは 3.0）', () => {
  // 10 × (1 − min(20, max(4, 20 − 10 / (2 + 8 / 4))) / 25) = 10 × (1 − 17.5 / 25) = 3.0
  assert.equal(final({ armor: 20, toughness: 8 }), 300)
})

test('耐性は 1 Lv ごとに 10%、10 Lv で 0', () => {
  assert.equal(final({ resistanceLevel: 2 }), 800)
  assert.equal(final({ resistanceLevel: 10 }), 0)
  assert.equal(final({ resistanceLevel: 12 }), 0)
})

test('EPF は 1 点ごとに 2%、20 点まで', () => {
  assert.equal(final({ protectionLevels: 8 }), 840)
  assert.equal(final({ protectionLevels: 25 }), 600)
  assert.equal(final({ reduceEnchantment: { id: 'minecraft:fire_protection', levels: 4 } }), 840)
  assert.equal(final({ reduceEnchantment: { id: 'minecraft:feather_falling', levels: 4 } }), 760)
  assert.equal(final({ reduceEnchantment: { id: 'minecraft:fire_protection', levels: 4, modifier: 1 } }), 920)
})

test('Mob の耐性は防御側の倍率に入り、float の 0.7 は 0.69 倍になる', () => {
  assert.equal(final({ target: { kind: 'mob', resist: { Physical: 0.7 }, resistTag: 'double' } }), 700)
  assert.equal(final({ target: { kind: 'mob', resist: { Physical: 0.7 }, resistTag: 'float' } }), 690)
  assert.equal(final({ target: { kind: 'mob', resist: { Fire: 1.4 }, resistTag: 'float' }, elementType: 'Fire' }), 1390)
})

test('Damage を float で渡すと 0.7 は 0.69 になる', () => {
  assert.equal(final({ damage: 0.7, damageTag: 'float' }), 69)
  assert.equal(final({ damage: 0.7, damageTag: 'double' }), 70)
})

test('プレイヤーの被ダメージには難易度補正が掛かる', () => {
  const fromMob = { attacker: { kind: 'mob' as const }, target: { kind: 'player' as const, defense: {} } }
  assert.equal(final({ ...fromMob, difficulty: 1 }), 800)
  assert.equal(final({ ...fromMob, difficulty: 2 }), 1000)
  assert.equal(final({ ...fromMob, difficulty: 3 }), 1200)
})

test('プレイヤーの防御側の倍率', () => {
  assert.equal(final({ attacker: { kind: 'mob' }, target: { kind: 'player', defense: { Base: 0.8, Physical: 0.9 } }, difficulty: 2 }), 720)
})

test('プレイヤーの体力への反映で double の誤差により 0.01 多く減ることがある', () => {
  const fromMob = { attacker: { kind: 'mob' as const }, target: { kind: 'player' as const, defense: {} }, difficulty: 2 }
  assert.equal(final({ ...fromMob, damage: 0.07 }), 8)
  assert.equal(final({ damage: 0.07, difficulty: 2 }), 7)
})

test('上限 9999.9 は難易度補正の前に掛かる', () => {
  const r = calculateDamage(input({ damage: 20000, attacker: { kind: 'mob' }, target: { kind: 'player', defense: {} }, difficulty: 3 }), 'current')
  assert.equal(r.finalE2, 1199988)
})

test('防具の前に計算の上限 21474.83 で止める', () => {
  const r = calculateDamage(input({ damage: 10000, attacker: { kind: 'player', attack: { Base: 3 } } }), 'current')
  const armor = r.steps.find((s) => s.kind === 'armor')
  assert.equal(armor?.kind === 'armor' && armor.calcCapped, true)
  assert.equal(armor?.kind === 'armor' && armor.afterE4, 214748300)
  assert.equal(r.finalE2, 999990)
})

test('FixedDamage は補正・軽減・難易度補正をすべて外す', () => {
  assert.equal(final({
    fixedDamage: true,
    attacker: { kind: 'player', attack: { Base: 2 } },
    target: { kind: 'player', defense: { Base: 0.5 } },
    armor: 20, toughness: 8, resistanceLevel: 5, protectionLevels: 10, difficulty: 3,
  }), 1000)
})

test('Bypass は段ごとに外れる', () => {
  assert.equal(final({ armor: 20, bypass: { ...noBypass, armorDefense: true } }), 1000)
  assert.equal(final({ resistanceLevel: 2, bypass: { ...noBypass, resistance: true } }), 1000)
  assert.equal(final({ attacker: { kind: 'player', attack: { Base: 2 } }, bypass: { ...noBypass, modifier: true } }), 1000)
})
