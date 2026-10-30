import { MODIFIER_KEYS } from '../calc/attributes.ts'
import { readRows, writeRows, type BuffRowData, type BuffSide } from './buffs.ts'
import { getField, setField, text } from './dom.ts'

declare global {
  interface Window {
    __TAURI__?: { core: { invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> } }
  }
}

export type PresetKind = 'attack' | 'defense'

interface Preset {
  fields: Record<string, string | boolean>
  buffs: Partial<Record<BuffSide, BuffRowData[]>>
}

interface PresetStore {
  version: 1
  attack: Record<string, Preset>
  defense: Record<string, Preset>
}

const BYPASS_FIELDS = ['fixedDamage', 'bypass.modifier', 'bypass.armorDefense', 'bypass.toughness', 'bypass.enchantments', 'bypass.resistance', 'bypass.difficulty']
const ATTACK_FIELDS = ['damage', 'damageTag', 'attackType', 'elementType', 'reduceId', 'reduceModifier', ...BYPASS_FIELDS, ...MODIFIER_KEYS.map((k) => `attack.${k}`)]
const GUARD_FIELDS = ['armor', 'toughness', 'resistanceLevel', 'protectionLevels', 'reduceLevels']
const PLAYER_DEFENSE_FIELDS = MODIFIER_KEYS.map((k) => `defense.${k}`)
const MOB_DEFENSE_FIELDS = ['resistTag', ...MODIFIER_KEYS.slice(1).map((k) => `resist.${k}`)]
/** 「重ねる」で足し合わせる守りの値 */
const STACKED_FIELDS = ['armor', 'toughness', 'protectionLevels', 'reduceLevels']

const KIND_LABEL: Record<PresetKind, string> = { attack: '攻撃', defense: '防御' }

let store: PresetStore = { version: 1, attack: {}, defense: {} }
/** presets.json を読めなかったときは、上書きして消さないよう保存を止める */
let writable = false
let location = ''
const status = document.querySelector<HTMLElement>('#preset-status')!

function showStatus(message: string, error = false): void {
  status.textContent = message
  status.classList.toggle('error', error)
}

function capture(kind: PresetKind): Preset {
  if (kind === 'attack') {
    return { fields: Object.fromEntries(ATTACK_FIELDS.map((name) => [name, getField(name)])), buffs: { attack: readRows('attack') } }
  }
  const player = text('target') === 'player'
  const names = ['target', ...GUARD_FIELDS, ...(player ? PLAYER_DEFENSE_FIELDS : MOB_DEFENSE_FIELDS)]
  const side: BuffSide = player ? 'defense' : 'resist'
  return { fields: Object.fromEntries(names.map((name) => [name, getField(name)])), buffs: { [side]: readRows(side) } }
}

function apply(preset: Preset, stack: boolean): void {
  for (const [name, value] of Object.entries(preset.fields)) {
    if (!stack) {
      setField(name, value)
    } else if (STACKED_FIELDS.includes(name)) {
      const sum = Number(getField(name) || 0) + Number(value || 0)
      if (Number.isFinite(sum)) setField(name, String(Math.round(sum * 1e6) / 1e6))
    }
  }
  for (const [side, rows] of Object.entries(preset.buffs) as [BuffSide, BuffRowData[]][]) writeRows(side, rows, stack)
}

function isStore(value: unknown): value is PresetStore {
  const v = value as PresetStore
  return typeof v === 'object' && v !== null && v.version === 1 && typeof v.attack === 'object' && typeof v.defense === 'object'
}

function refreshList(kind: PresetKind, selected?: string): void {
  const select = document.querySelector<HTMLSelectElement>(`.preset-row[data-kind="${kind}"] [data-role="list"]`)!
  const names = Object.keys(store[kind]).sort((a, b) => a.localeCompare(b, 'ja'))
  select.replaceChildren(new Option(names.length === 0 ? '（保存なし）' : '（選択）', ''), ...names.map((name) => new Option(name, name)))
  select.value = selected && names.includes(selected) ? selected : ''
}

/** ファイルに書けたときだけ、メモリ上のプリセットを next に置き換える。 */
async function commit(next: PresetStore): Promise<void> {
  await window.__TAURI__!.core.invoke('save_presets', { json: `${JSON.stringify(next, null, 2)}\n` })
  store = next
}

export async function setupPresets(onChange: () => void): Promise<void> {
  const rows = document.querySelectorAll<HTMLElement>('.preset-row')
  const setEnabled = (enabled: boolean) => {
    for (const control of document.querySelectorAll<HTMLButtonElement | HTMLInputElement>('.preset-row button, .preset-row input')) control.disabled = !enabled
  }
  for (const kind of ['attack', 'defense'] as const) refreshList(kind)

  const tauri = window.__TAURI__
  if (!tauri) {
    setEnabled(false)
    showStatus('プリセットは exe で開いたときだけ保存できます', true)
    return
  }
  try {
    const [path, json] = await tauri.core.invoke<[string, string | null]>('load_presets')
    location = path
    if (json !== null) {
      const parsed: unknown = JSON.parse(json)
      if (!isStore(parsed)) throw new Error('形式が違います')
      store = parsed
    }
    writable = true
    for (const element of document.querySelectorAll<HTMLElement>('.preset-location')) element.textContent = `保存先：${location}`
  } catch (error) {
    showStatus(`${location || 'presets.json'} を読み込めないため、保存を止めています（ファイルは変更していません）：${error instanceof Error ? error.message : String(error)}`, true)
  }
  for (const kind of ['attack', 'defense'] as const) refreshList(kind)
  setEnabled(writable)

  for (const row of rows) {
    const kind = row.dataset.kind as PresetKind
    const select = row.querySelector<HTMLSelectElement>('[data-role="list"]')!
    const nameInput = row.querySelector<HTMLInputElement>('[data-role="name"]')!
    row.addEventListener('click', async (event) => {
      const action = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-action]')?.dataset.action
      if (!action) return
      const selected = select.value
      try {
        if (action === 'save') {
          const name = nameInput.value.trim()
          if (name === '') return showStatus(`${KIND_LABEL[kind]}のプリセット名を入力してください`, true)
          if (store[kind][name] && !window.confirm(`${KIND_LABEL[kind]}のプリセット「${name}」を上書きしますか？`)) return
          await commit({ ...store, [kind]: { ...store[kind], [name]: capture(kind) } })
          refreshList(kind, name)
          showStatus(`${KIND_LABEL[kind]}のプリセット「${name}」を保存しました`)
          return
        }
        const preset = store[kind][selected]
        if (!preset) return showStatus(`${KIND_LABEL[kind]}のプリセットを選んでください`, true)
        if (action === 'delete') {
          if (!window.confirm(`${KIND_LABEL[kind]}のプリセット「${selected}」を削除しますか？`)) return
          const { [selected]: _removed, ...rest } = store[kind]
          await commit({ ...store, [kind]: rest })
          refreshList(kind)
          showStatus(`${KIND_LABEL[kind]}のプリセット「${selected}」を削除しました`)
          return
        }
        if (action === 'stack' && kind === 'defense' && preset.fields.target !== text('target')) {
          return showStatus(`「${selected}」は${preset.fields.target === 'player' ? 'プレイヤー' : 'Mob'}用なので、今の対象には重ねられません`, true)
        }
        apply(preset, action === 'stack')
        nameInput.value = selected
        onChange()
        showStatus(`${KIND_LABEL[kind]}のプリセット「${selected}」を${action === 'stack' ? '重ねました' : '読み込みました'}`)
      } catch (error) {
        showStatus(`保存できませんでした：${error instanceof Error ? error.message : String(error)}`, true)
      }
    })
  }
}
