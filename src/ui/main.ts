import { MODIFIER_KEYS } from '../calc/attributes.ts'
import {
  calculateDamage,
  type AttackType,
  type Bypass,
  type CalcMode,
  type DamageInput,
  type DamageResult,
  type ElementType,
  type ModifierCalc,
  type ModifierKey,
  type Modifiers,
  type Step,
} from '../calc/damage.ts'
import { dataGet, min, type NumberTag } from '../calc/mc.ts'
import { renderBuffs, setupBuffs, toBuffs } from './buffs.ts'
import { InputError, checked, field, form, text } from './dom.ts'
import { setupPresets } from './presets.ts'

const DIFFICULTY_NAMES: Record<number, string> = { 1: 'Normal', 2: 'Hard', 3: 'Blessless' }
const MODIFIER_LABELS: Record<string, string> = { attack: '攻撃元の補正', defense: '対象の補正', resist: '対象の耐性' }
const BYPASS_KEYS = ['modifier', 'armorDefense', 'toughness', 'enchantments', 'resistance', 'difficulty'] as const

const stepsBody = document.querySelector<HTMLTableSectionElement>('#steps')!
const finalLabel = document.querySelector<HTMLElement>('#final-label')!
const finalValue = document.querySelector<HTMLElement>('#final-value')!
const finalNote = document.querySelector<HTMLElement>('#final-note')!
const errorBox = document.querySelector<HTMLElement>('#error')!
const reduceLevelsLabel = document.querySelector<HTMLElement>('#reduce-levels-label')!
const modeButtons = document.querySelectorAll<HTMLButtonElement>('[data-mode]')

let mode: CalcMode = 'current'

function number(name: string, label: string): number {
  const value = Number(text(name))
  if (text(name).trim() === '' || !Number.isFinite(value)) throw new InputError(`${label} に数値を入力してください`, field(name))
  return value
}

function integer(name: string, label: string): number {
  return Math.trunc(number(name, label))
}

function modifiers(prefix: string, keys: ModifierKey[]): Modifiers {
  const result: Modifiers = {}
  for (const key of keys) {
    const raw = text(`${prefix}.${key}`).trim()
    if (raw === '') continue
    const value = Number(raw)
    if (!Number.isFinite(value)) throw new InputError(`${MODIFIER_LABELS[prefix]}（${key}）に数値を入力してください`, field(`${prefix}.${key}`))
    result[key] = value
  }
  return result
}

/** index.html の軽減エンチャントの選択肢は「名前（×係数）」の形で書いてある */
function reduceName(): string {
  const select = field('reduceId') as HTMLSelectElement
  if (select.value === '' || select.value === 'other') return '軽減エンチャント'
  return select.selectedOptions[0]!.text.split('（')[0]!
}

function readInput(): DamageInput {
  const reduceId = text('reduceId')
  const reduceModifier = text('reduceModifier').trim()
  return {
    damage: number('damage', 'Damage'),
    damageTag: text('damageTag') as NumberTag,
    attackType: text('attackType') as AttackType,
    elementType: text('elementType') as ElementType,
    fixedDamage: checked('fixedDamage'),
    bypass: {
      modifier: checked('bypass.modifier'),
      armorDefense: checked('bypass.armorDefense'),
      toughness: checked('bypass.toughness'),
      enchantments: checked('bypass.enchantments'),
      resistance: checked('bypass.resistance'),
      difficulty: checked('bypass.difficulty'),
    },
    attacker: text('attacker') === 'player'
      ? { kind: 'player', attack: modifiers('attack', MODIFIER_KEYS), buffs: toBuffs('attack') }
      : { kind: 'mob' },
    target: text('target') === 'player'
      ? { kind: 'player', defense: modifiers('defense', MODIFIER_KEYS), buffs: toBuffs('defense') }
      : { kind: 'mob', resist: modifiers('resist', MODIFIER_KEYS.slice(1)), resistTag: text('resistTag') as NumberTag, buffs: toBuffs('resist') },
    armor: number('armor', '防具値'),
    toughness: number('toughness', '防具強度'),
    resistanceLevel: integer('resistanceLevel', '耐性エフェクトの Lv'),
    protectionLevels: integer('protectionLevels', 'ダメージ軽減の合計 Lv'),
    reduceEnchantment: reduceId === ''
      ? null
      : {
          id: reduceId,
          levels: integer('reduceLevels', `${reduceName()}の合計 Lv`),
          ...(reduceModifier === '' ? {} : { modifier: integer('reduceModifier', 'エンチャント係数') }),
        },
    difficulty: Number(text('difficulty')),
  }
}

const e2 = (value: number) => (value / 100).toFixed(2)
const e4 = (value: number) => (value / 10000).toFixed(4)
const limitText = (valueE2: number) => String(valueE2 / 100)
const LIMITED_TEXT = '掛けると int の上限を超えるので、先に Damage を止める'

function modifierText(calc: ModifierCalc, input: DamageInput, base: string, limited: boolean): { condition: string; detail: string } {
  const second = input.elementType === 'None' ? 'None 1.00' : `${input.elementType} ${e2(calc.second)}`
  const clamped = calc.applied === calc.raw ? '' : `（式では ${e2(calc.raw)}、下限 ${e2(calc.lowerBound)}）`
  const formula = `${base} × (${input.attackType} ${e2(calc.first)} + ${second} − 1)`
  return {
    condition: `×${e2(calc.applied)}${clamped}`,
    detail: limited ? `${formula}。${LIMITED_TEXT}` : formula,
  }
}

interface Row {
  label: string
  condition: string
  detail?: string
  after: string
  raw: string
  skipped: boolean
}

function row(step: Step, input: DamageInput, bypass: Bypass, previous: Step | undefined): Row {
  switch (step.kind) {
    case 'input':
      return {
        label: `Damage（${step.tag}）`,
        condition: step.stored === input.damage ? '入力どおり' : `${step.tag} に丸めると ${step.stored}`,
        after: String(step.stored),
        raw: `${dataGet(step.stored, 100)} (×100)`,
        skipped: false,
      }
    case 'attackModifier':
      return {
        label: '攻撃側の倍率',
        ...(step.skip === 'mobAttacker'
          ? { condition: '攻撃元が Mob なので掛からない' }
          : step.skip === 'bypass'
            ? { condition: 'BypassModifier' }
            : modifierText(step.calc!, input, `Base ${e2(step.calc!.base)}`, step.limited)),
        after: step.after.toFixed(4),
        raw: `${dataGet(step.after, 100)} (×100)`,
        skipped: step.skip !== null,
      }
    case 'armor': {
      const bypassed = [bypass.armorDefense && '防具値（BypassArmorDefense）', bypass.toughness && '防具強度（BypassToughness）'].filter(Boolean)
      const ratio = step.beforeE2 > 0 ? `×${(step.afterE4 / (step.beforeE2 * 100)).toFixed(4)}` : ''
      const values = `防具値 ${e2(step.defensePoints)}・防具強度 ${e2(step.toughness)}`
      const details = [
        step.skip || ratio === '' ? '' : values,
        step.calcCapped ? `Damage を ${limitText(step.calcLimitE2)} で止めて計算` : '',
        bypassed.length > 0 ? `${bypassed.join('・')}を 0 として計算` : '',
      ].filter((d) => d !== '')
      return {
        label: '防具',
        condition: step.skip ? '防具値・防具強度がどちらも 0' : ratio || values,
        ...(details.length > 0 ? { detail: details.join('。') } : {}),
        after: e4(step.afterE4),
        raw: `${step.afterE4} (×10000)`,
        skipped: step.skip && !step.calcCapped,
      }
    }
    case 'resistance':
      return {
        label: '耐性エフェクト',
        condition: step.skip === 'bypass' ? 'BypassResistance' : step.skip === 'none' ? '耐性なし' : `Lv ${step.level} → ×${((10 - min(step.level, 10)) / 10).toFixed(1)}`,
        after: e4(step.afterE4),
        raw: `${step.afterE4} (×10000)`,
        skipped: step.skip !== null,
      }
    case 'enchantment': {
      const reduce = step.reduceLevels !== null ? ` + ${reduceName()} ${step.reduceLevels} × ${step.coefficient}` : ''
      return {
        label: 'エンチャント',
        condition: step.skip === 'bypass' ? 'BypassEnchantments' : `EPF ${step.epf}${step.skip === 'none' ? '' : ` → ×${((100 - min(step.epf, 20) * 2) / 100).toFixed(2)}`}`,
        ...(step.skip === 'bypass' ? {} : { detail: `ダメージ軽減 ${step.protection}${reduce}` }),
        after: e4(step.afterE4),
        raw: `${step.afterE4} (×10000)`,
        skipped: step.skip !== null,
      }
    }
    case 'defenseModifier':
      return {
        label: '防御側の倍率',
        ...(step.skip === 'bypass'
          ? { condition: 'BypassModifier' }
          : modifierText(step.calc!, input, `Base ${e2(step.calc!.base)}`, step.limited)),
        after: e2(step.afterE2),
        raw: `${step.afterE2} (×100)`,
        skipped: step.skip !== null,
      }
    case 'cap':
      return {
        label: `上限 ${limitText(step.limitE2)}`,
        condition: step.capped ? `${limitText(step.limitE2)} で止める` : '上限より小さい',
        after: e2(step.afterE2),
        raw: `${step.afterE2} (×100)`,
        skipped: !step.capped,
      }
    case 'difficulty':
      return {
        label: '難易度補正',
        condition: step.skip === 'mobTarget' ? '対象が Mob なので掛からない' : step.skip === 'bypass' ? 'BypassDifficulty' : `${DIFFICULTY_NAMES[input.difficulty] ?? `難度 ${input.difficulty}`} ×${(step.factor / 10).toFixed(1)}`,
        after: e2(step.afterE2),
        raw: `${step.afterE2} (×100)`,
        skipped: step.skip !== null,
      }
    case 'fluctuation': {
      const changed = previous !== undefined && 'afterE2' in previous && previous.afterE2 !== step.afterE2
      return {
        label: '体力への反映',
        condition: step.skip === 'mobTarget'
          ? 'Mob は整数のまま体力から引く'
          : changed ? 'double の誤差で 0.01 多く減る（ScoreToHPFluc）' : 'ScoreToHPFluc に積む',
        after: e2(step.afterE2),
        raw: `${step.afterE2} (×100)`,
        skipped: step.skip !== null || !changed,
      }
    }
  }
}

function cell(tag: 'td' | 'th' | 'span', content: string, className?: string): HTMLElement {
  const element = document.createElement(tag)
  element.textContent = content
  if (className) element.className = className
  return element
}

const PAIRS: Record<string, { attacker: string; target: string }> = {
  deal: { attacker: 'player', target: 'mob' },
  take: { attacker: 'mob', target: 'player' },
}
const pairButtons = document.querySelectorAll<HTMLButtonElement>('[data-pair]')

function syncVisibility(): void {
  const shown = new Set([`attacker-${text('attacker')}`, `target-${text('target')}`])
  for (const fieldset of form.querySelectorAll<HTMLFieldSetElement>('fieldset[data-show]')) {
    fieldset.hidden = !shown.has(fieldset.dataset.show ?? '')
  }
  const fixed = checked('fixedDamage')
  for (const key of BYPASS_KEYS) (field(`bypass.${key}`) as HTMLInputElement).disabled = fixed
  for (const button of modeButtons) button.setAttribute('aria-pressed', String(button.dataset.mode === mode))
  reduceLevelsLabel.textContent = `${reduceName()}の合計 Lv`
  for (const button of pairButtons) {
    const pair = PAIRS[button.dataset.pair ?? '']
    button.setAttribute('aria-pressed', String(pair?.attacker === text('attacker') && pair.target === text('target')))
  }
}

function renderAllBuffs(result: DamageResult | null): void {
  renderBuffs('attack', result?.attackValues ?? null)
  renderBuffs('defense', result && text('target') === 'player' ? result.defenseValues : null)
  renderBuffs('resist', result && text('target') === 'mob' ? result.defenseValues : null)
}

function render(): void {
  syncVisibility()
  for (const element of form.querySelectorAll('[aria-invalid]')) element.removeAttribute('aria-invalid')
  let input: DamageInput
  try {
    input = readInput()
  } catch (error) {
    if (!(error instanceof InputError)) throw error
    error.element?.setAttribute('aria-invalid', 'true')
    errorBox.textContent = error.message
    errorBox.hidden = false
    finalValue.textContent = '-'
    stepsBody.replaceChildren()
    renderAllBuffs(null)
    return
  }
  errorBox.hidden = true
  const result = calculateDamage(input, mode)
  renderAllBuffs(result)
  finalLabel.textContent = input.target.kind === 'mob' ? '最終ダメージ（Mob の体力から引く量）' : '最終ダメージ（緩衝体力を消費する前）'
  finalValue.textContent = result.final.toFixed(2)
  finalNote.textContent = input.target.kind === 'mob' ? 'Mob の体力より大きい分は、体力の値で止まる' : ''
  stepsBody.replaceChildren(...result.steps.map((step, index) => {
    const r = row(step, input, result.bypass, result.steps[index - 1])
    const tr = document.createElement('tr')
    if (r.skipped) tr.className = 'skipped'
    const head = cell('th', '')
    head.setAttribute('scope', 'row')
    head.append(cell('span', r.label, 'step'), cell('span', r.condition))
    if (r.detail) head.append(cell('span', r.detail, 'detail'))
    const after = cell('td', '', 'num')
    after.append(cell('span', r.after, 'after'), cell('span', r.raw, 'raw'))
    tr.append(cell('td', String(index + 1), 'num'), head, after)
    return tr
  }))
}

for (const button of pairButtons) {
  button.addEventListener('click', () => {
    const pair = PAIRS[button.dataset.pair ?? '']
    if (!pair) return
    field('attacker').value = pair.attacker
    field('target').value = pair.target
    render()
  })
}

for (const button of modeButtons) {
  button.addEventListener('click', () => {
    mode = button.dataset.mode as CalcMode
    render()
  })
}

for (const side of ['attack', 'defense', 'resist'] as const) setupBuffs(side, render)
form.addEventListener('submit', (event) => event.preventDefault())
form.addEventListener('input', render)
form.addEventListener('change', render)
render()
void setupPresets(render)
