export const form = document.querySelector<HTMLFormElement>('#form')!

export class InputError extends Error {
  readonly element: Element | undefined

  constructor(message: string, element?: Element) {
    super(message)
    this.element = element
  }
}

export function field(name: string): HTMLInputElement | HTMLSelectElement {
  const element = form.elements.namedItem(name)
  if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement)) throw new Error(`入力欄 ${name} が無い`)
  return element
}

export const text = (name: string) => field(name).value
export const checked = (name: string) => (field(name) as HTMLInputElement).checked

/** チェックボックスは真偽値、それ以外は入力欄の文字列。 */
export function getField(name: string): string | boolean {
  const element = field(name)
  return element instanceof HTMLInputElement && element.type === 'checkbox' ? element.checked : element.value
}

export function setField(name: string, value: string | boolean): void {
  const element = field(name)
  if (element instanceof HTMLInputElement && element.type === 'checkbox') element.checked = value === true
  else element.value = String(value)
}

export function template(id: string): DocumentFragment {
  const element = document.querySelector<HTMLTemplateElement>(`#${id}`)
  if (!element) throw new Error(`template ${id} が無い`)
  return element.content.cloneNode(true) as DocumentFragment
}
