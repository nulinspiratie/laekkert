import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import App from './App'
import type { Bar, BarChanges, BarItem } from './types'

function item(over: Partial<BarItem> & { name: string }): BarItem {
  return { aliases: [], kind: 'other', fresh: false, state: null, used_in: [], recipe: null, ...over }
}

const drink = (slug: string, name: string) => ({ slug, name })

const ITEMS: BarItem[] = [
  item({ name: 'absinthe', kind: 'liqueurs', state: 'have' }),
  item({ name: 'campari', kind: 'aperitifs', state: 'have', used_in: [drink('negroni', 'Negroni')] }),
  item({ name: 'crème de violette', kind: 'liqueurs', used_in: [drink('aviation', 'Aviation')] }),
  item({ name: 'lime juice', fresh: true, used_in: [drink('daiquiri', 'Daiquiri')] }),
  item({ name: 'mezcal', kind: 'spirits', state: 'dont', used_in: [drink('naked-and-famous', 'Naked and famous')] }),
  item({ name: 'mint', fresh: true, used_in: [drink('mojito', 'Mojito')] }),
  item({ name: 'orgeat', kind: 'syrups', used_in: [drink('mai-tai', 'Mai tai')] }),
  item({
    name: 'white rum',
    kind: 'spirits',
    state: 'have',
    aliases: ['light rum', 'silver rum'],
    used_in: [drink('daiquiri', 'Daiquiri'), drink('mojito', 'Mojito')],
  }),
]

const everyday: Bar = {
  items: ITEMS,
  set_up: true,
  counts: { can_make: 3, fresh_only: 2, missing: 1, unsorted: 2, total: 8 },
}

const firstVisit: Bar = {
  items: ITEMS.map((it) => ({ ...it, state: null })),
  set_up: false,
  counts: { can_make: 0, fresh_only: 0, missing: 0, unsorted: 8, total: 8 },
}

/** The bar with one item changed, as the server would send it back. */
function withItem(bar: Bar, name: string, patch: Partial<BarItem>): Bar {
  return { ...bar, items: bar.items.map((it) => (it.name === name ? { ...it, ...patch } : it)) }
}

function without(bar: Bar, name: string): Bar {
  return { ...bar, items: bar.items.filter((it) => it.name !== name) }
}

type Post = (body: BarChanges) => Response | Promise<Response>

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

function stubBar(bar: Bar, post: Post = () => json({ error: 'Not answered.' }, 500)) {
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return post(JSON.parse(String(init.body)) as BarChanges)
    return json(bar)
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

function posted(fetch: ReturnType<typeof stubBar>): unknown[] {
  return fetch.mock.calls.filter(([, init]) => init?.method === 'POST').map(([, init]) => JSON.parse(String(init!.body)))
}

function stubViewport(desktop: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: desktop && query === '(min-width: 768px)',
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  )
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

async function openBar() {
  render(
    <MemoryRouter initialEntries={['/bar']}>
      <App />
    </MemoryRouter>,
  )
  await screen.findByRole('heading', { level: 1, name: 'The bar' })
}

beforeEach(() => stubViewport(false))

test('shows the everyday subtitle and can-make card', async () => {
  stubBar(everyday)
  await openBar()
  expect(screen.getByText('One bar for the household · 3 of 6 bottles in')).toBeInTheDocument()
  const card = screen.getByRole('link', { name: 'You can make 3 drinks now' })
  expect(card).toHaveAttribute('href', '/drinks?bar=can')
  expect(screen.getByRole('link', { name: 'Drinks' })).toHaveAttribute('href', '/drinks')
  expect(screen.queryByText(/sorted$/)).not.toBeInTheDocument()
  expect(document.documentElement.dataset.side).toBe('drinks')

  const unsorted = screen.getByRole('region', { name: 'Not sorted yet' })
  expect(
    within(unsorted).getByText(
      'New from drinks you added. Until you sort them, drinks that use them count as missing.',
    ),
  ).toBeInTheDocument()
  expect(within(unsorted).getByText('2')).toBeInTheDocument()

  const spirits = screen.getByRole('region', { name: 'Spirits' })
  expect(within(spirits).getByText('1 of 2 in')).toBeInTheDocument()
  expect(within(spirits).getByText('Used in 2 drinks')).toBeInTheDocument()
  expect(within(spirits).getByText('Used in 1 drink')).toBeInTheDocument()
  expect(within(screen.getByRole('region', { name: 'Liqueurs' })).getByText('Not in any drink yet')).toBeInTheDocument()

  const fresh = screen.getByRole('region', { name: 'Fresh, so never tracked' })
  expect(within(fresh).getByRole('button', { name: 'Lime juice' })).toBeInTheDocument()
  expect(within(fresh).getByText('Open a bottle or a fresh item to move it between the two.')).toBeInTheDocument()
})

test('shows the first-visit subtitle and progress', async () => {
  stubBar(firstVisit)
  await openBar()
  expect(
    screen.getByText('Lækkert found 6 bottles in your drinks. Tap Have for each one in your cabinet.'),
  ).toBeInTheDocument()
  expect(screen.getByText('0 of 6 sorted')).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: /You can make/ })).not.toBeInTheDocument()
  const unsorted = screen.getByRole('region', { name: 'Not sorted yet' })
  expect(
    within(unsorted).getByText(
      'Nothing is sorted yet, so no drink shows under ‘Can make now’. Tap what you have, then mark the rest in one go.',
    ),
  ).toBeInTheDocument()
  expect(within(unsorted).getByRole('button', { name: 'Mark the other 6 as don’t have' })).toBeInTheDocument()
})

test('toggles an item in one tap', async () => {
  const answer = deferred<Response>()
  const fetch = stubBar(everyday, () => answer.promise)
  await openBar()
  fireEvent.click(screen.getByRole('button', { name: "Campari: have. Tap if you've run out." }))

  // At once, before the server answers.
  const toggle = screen.getByRole('button', { name: "Campari: don't have. Tap when you've bought it." })
  expect(toggle).toHaveTextContent("Don't have")
  expect(posted(fetch)).toEqual([{ dont_have: ['campari'] }])

  // A second tap while the write is in flight is ignored.
  fireEvent.click(toggle)
  expect(posted(fetch)).toHaveLength(1)

  await act(async () => answer.resolve(json(withItem(everyday, 'campari', { state: 'dont' }))))
  expect(screen.getByRole('button', { name: "Campari: don't have. Tap when you've bought it." })).toBeEnabled()
  expect(screen.getByText('One bar for the household · 2 of 6 bottles in')).toBeInTheDocument()
})

const refusal = 'The bar file could not be read, so nothing was changed.'
const refuse = () => json({ error: refusal }, 503)

test('rolls back a toggle the server refuses, saying why in its row', async () => {
  stubBar(everyday, refuse)
  await openBar()
  fireEvent.click(screen.getByRole('button', { name: "White rum: have. Tap if you've run out." }))
  // Next to the row that failed, so it shows wherever the page is scrolled.
  const toggle = await screen.findByRole('button', { name: "White rum: have. Tap if you've run out." })
  expect(await within(toggle.parentElement!).findByRole('alert')).toHaveTextContent(refusal)
  expect(screen.getAllByRole('alert')).toHaveLength(1)

  // The next write clears it.
  fireEvent.click(screen.getByRole('button', { name: "Campari: have. Tap if you've run out." }))
  await waitFor(() => expect(within(toggle.parentElement!).queryByRole('alert')).not.toBeInTheDocument())
  const campari = await screen.findByRole('button', { name: "Campari: have. Tap if you've run out." })
  expect(await within(campari.parentElement!).findByRole('alert')).toHaveTextContent(refusal)
})

test('says why an unsorted pick was refused in its row', async () => {
  stubBar(everyday, refuse)
  await openBar()
  fireEvent.click(screen.getByRole('button', { name: 'Orgeat: have' }))
  const pick = await screen.findByRole('button', { name: 'Orgeat: have' })
  expect(await within(pick.parentElement!).findByRole('alert')).toHaveTextContent(refusal)
})

test('says why marking the rest was refused next to the button', async () => {
  stubBar(everyday, refuse)
  await openBar()
  fireEvent.click(screen.getByRole('button', { name: 'Mark the other 2 as don’t have' }))
  // The section empties at once and comes back with the rollback.
  const unsorted = await screen.findByRole('region', { name: 'Not sorted yet' })
  expect(await within(unsorted).findByRole('alert')).toHaveTextContent(refusal)
  expect(within(unsorted).getByRole('button', { name: 'Orgeat: have' })).toBeInTheDocument()
})

test('says why an add was refused next to the add button', async () => {
  stubBar(everyday, refuse)
  await openBar()
  fireEvent.change(screen.getByRole('searchbox', { name: 'Find a bottle' }), { target: { value: 'Falernum' } })
  const add = screen.getByRole('button', { name: 'Add ‘Falernum’ to the bar' })
  fireEvent.click(add)
  expect(await within(add.parentElement!).findByRole('alert')).toHaveTextContent(refusal)
  expect(screen.getByRole('searchbox', { name: 'Find a bottle' })).toHaveValue('Falernum')
})

test('sorts an unsorted item', async () => {
  const fetch = stubBar(everyday, () => json(withItem(everyday, 'orgeat', { state: 'have' })))
  await openBar()
  const unsorted = screen.getByRole('region', { name: 'Not sorted yet' })
  fireEvent.click(within(unsorted).getByRole('button', { name: 'Orgeat: have' }))
  expect(posted(fetch)).toEqual([{ have: ['orgeat'] }])
  // It moves into its kind at once.
  const syrups = await screen.findByRole('region', { name: 'Syrups' })
  expect(within(syrups).getByRole('button', { name: "Orgeat: have. Tap if you've run out." })).toBeInTheDocument()
  expect(within(unsorted).getByRole('button', { name: 'Mark it as don’t have' })).toBeInTheDocument()
})

test('marks the rest as don’t have', async () => {
  const sorted = withItem(withItem(everyday, 'orgeat', { state: 'dont' }), 'crème de violette', { state: 'dont' })
  const fetch = stubBar(everyday, () => json(sorted))
  await openBar()
  fireEvent.click(screen.getByRole('button', { name: 'Mark the other 2 as don’t have' }))
  expect(posted(fetch)).toEqual([{ dont_have: ['crème de violette', 'orgeat'] }])
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Not sorted yet' })).not.toBeInTheDocument())
})

test('filters by name and alias', async () => {
  stubBar(everyday)
  await openBar()
  const search = screen.getByRole('searchbox', { name: 'Find a bottle' })
  fireEvent.change(search, { target: { value: 'LIGHT' } })
  const spirits = screen.getByRole('region', { name: 'Spirits' })
  expect(within(spirits).getByText('Also called light rum')).toBeInTheDocument()
  expect(screen.queryByText('Mezcal')).not.toBeInTheDocument()
  expect(screen.queryByRole('region', { name: 'Not sorted yet' })).not.toBeInTheDocument()
  expect(screen.queryByRole('region', { name: 'Fresh, so never tracked' })).not.toBeInTheDocument()

  fireEvent.change(search, { target: { value: 'creme' } })
  expect(screen.getByText('Crème de violette')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Mark it as don’t have' })).toBeInTheDocument()
})

test('offers to add a bottle with no match', async () => {
  const added = { ...everyday, items: [...ITEMS, item({ name: 'Falernum', state: 'have' })] }
  const fetch = stubBar(everyday, () => json(added))
  await openBar()
  const search = screen.getByRole('searchbox', { name: 'Find a bottle' })
  fireEvent.change(search, { target: { value: 'Falernum ' } })
  expect(screen.getByRole('heading', { name: 'No bottle called ‘Falernum’' })).toBeInTheDocument()
  expect(
    screen.getByText('Check the spelling, or add it. It goes in as a bottle you have, and you can change that after.'),
  ).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Add ‘Falernum’ to the bar' }))
  expect(posted(fetch)).toEqual([{ have: ['Falernum'] }])
  await waitFor(() => expect(search).toHaveValue(''))
  expect(screen.getByRole('button', { name: "Falernum: have. Tap if you've run out." })).toBeInTheDocument()
})

test('adds a fresh item', async () => {
  const added = { ...everyday, items: [...ITEMS, item({ name: 'egg white', fresh: true })] }
  const fetch = stubBar(everyday, () => json(added))
  await openBar()
  const search = screen.getByRole('searchbox', { name: 'Find a bottle' })
  fireEvent.change(search, { target: { value: 'egg white' } })
  fireEvent.click(screen.getByRole('button', { name: "It's fresh: add it without tracking" }))
  expect(posted(fetch)).toEqual([{ fresh: ['egg white'] }])
  await waitFor(() => expect(search).toHaveValue(''))
  const fresh = screen.getByRole('region', { name: 'Fresh, so never tracked' })
  expect(within(fresh).getByRole('button', { name: 'Egg white' })).toBeInTheDocument()
})

test('add a bottle focuses the search field', async () => {
  stubBar(everyday)
  await openBar()
  fireEvent.click(screen.getAllByRole('button', { name: 'Add a bottle' })[0])
  expect(screen.getByRole('searchbox', { name: 'Find a bottle' })).toHaveFocus()
})

test('a desktop says Click and has a More button', async () => {
  stubViewport(true)
  stubBar(everyday)
  await openBar()
  expect(screen.getByRole('button', { name: "White rum: have. Click if you've run out." })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: "Mezcal: don't have. Click when you've bought it." })).toBeInTheDocument()
  const aside = screen.getByRole('complementary')
  expect(within(aside).getByRole('link', { name: /You can make 3 drinks now/ })).toHaveAttribute('href', '/drinks?bar=can')
  expect(within(aside).getByText('From this bar')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'More for White rum' }))
  expect(screen.getByRole('dialog', { name: 'White rum' })).toBeInTheDocument()
})

test('the first-visit subtitle says Click on a desktop', async () => {
  stubViewport(true)
  stubBar(firstVisit)
  await openBar()
  expect(
    screen.getByText('Lækkert found 6 bottles in your drinks. Click Have for each one in your cabinet.'),
  ).toBeInTheDocument()
})

test('a desktop says every bottle is sorted when none is left', async () => {
  stubViewport(true)
  const sorted = withItem(withItem(everyday, 'orgeat', { state: 'dont' }), 'crème de violette', { state: 'dont' })
  stubBar(sorted)
  await openBar()
  expect(screen.getByText('Every bottle is sorted')).toBeInTheDocument()
  fireEvent.change(screen.getByRole('searchbox', { name: 'Find a bottle' }), { target: { value: 'benedictine' } })
  expect(screen.getByText('Check the spelling, or add it as a bottle you have.')).toBeInTheDocument()
})

describe('the item sheet', () => {
  /** The row's name (not its toggle, whose label starts with the name and a colon). */
  const row = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}(?!:)`) })

  async function openSheet(name: string, bar: Bar = everyday, post?: Post) {
    const fetch = stubBar(bar, post)
    await openBar()
    fireEvent.click(row(name))
    return { fetch, dialog: screen.getByRole('dialog', { name }) }
  }

  test('opens the item sheet', async () => {
    const { dialog } = await openSheet('White rum')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(within(dialog).getByText('Spirits · used in 2 drinks')).toBeInTheDocument()
    const inBar = within(dialog).getByRole('radiogroup', { name: 'In the bar' })
    expect(within(inBar).getByRole('radio', { name: 'Have' })).toHaveAttribute('aria-checked', 'true')
    expect(within(dialog).getByRole('link', { name: 'Daiquiri' })).toHaveAttribute('href', '/drinks/daiquiri')
    expect(within(dialog).getByText('A recipe that says one of these means white rum.')).toBeInTheDocument()

    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(row('White rum')).toHaveFocus()
  })

  test('closes on a backdrop click, not on a click inside the sheet', async () => {
    const { dialog } = await openSheet('White rum')
    const box = { left: 0, top: 64, right: 400, bottom: 800, width: 400, height: 736, x: 0, y: 64 }
    dialog.getBoundingClientRect = () => ({ ...box, toJSON: () => box }) as DOMRect
    // The dialog's own padding or margins, inside its box.
    fireEvent.click(dialog, { clientX: 200, clientY: 300 })
    expect(screen.getByRole('dialog', { name: 'White rum' })).toBeInTheDocument()
    // Above the sheet: the backdrop.
    fireEvent.click(dialog, { clientX: 200, clientY: 20 })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  test('sets the state from the sheet', async () => {
    const { fetch, dialog } = await openSheet('White rum', everyday, () =>
      json(withItem(everyday, 'white rum', { state: 'dont' })),
    )
    fireEvent.click(within(dialog).getByRole('radio', { name: "Don't have" }))
    expect(posted(fetch)).toEqual([{ dont_have: ['white rum'] }])
    await waitFor(() =>
      expect(within(dialog).getByRole('radio', { name: "Don't have" })).toHaveAttribute('aria-checked', 'true'),
    )
  })

  test('adds and removes another name', async () => {
    let bar = everyday
    const { fetch, dialog } = await openSheet('White rum', everyday, (body) => {
      if (body.add_names) bar = withItem(bar, 'white rum', { aliases: ['light rum', 'silver rum', 'rhum blanc'] })
      if (body.remove_names) bar = withItem(bar, 'white rum', { aliases: ['silver rum', 'rhum blanc'] })
      return json(bar)
    })
    const input = within(dialog).getByRole('textbox', { name: 'Add another name' })
    fireEvent.change(input, { target: { value: ' rhum blanc ' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }))
    expect(await within(dialog).findByRole('button', { name: 'Remove the name rhum blanc' })).toBeInTheDocument()
    expect(input).toHaveValue('')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove the name light rum' }))
    await waitFor(() =>
      expect(within(dialog).queryByRole('button', { name: 'Remove the name light rum' })).not.toBeInTheDocument(),
    )
    expect(posted(fetch)).toEqual([
      { add_names: { 'white rum': ['rhum blanc'] } },
      { remove_names: { 'white rum': ['light rum'] } },
    ])
  })

  test('shows a refusal inside the sheet', async () => {
    const sentence = '‘Light rum’ is already an item. Fold one into the other instead.'
    const { dialog } = await openSheet('Campari', everyday, () => json({ error: sentence }, 400))
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Add another name' }), {
      target: { value: 'light rum' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(sentence)
  })

  test('changes kind', async () => {
    const { fetch, dialog } = await openSheet('White rum', everyday, () =>
      json(withItem(everyday, 'white rum', { kind: 'liqueurs' })),
    )
    const kind = within(dialog).getByRole('combobox', { name: 'Kind' })
    expect(kind).toHaveValue('spirits')
    fireEvent.change(kind, { target: { value: 'liqueurs' } })
    expect(posted(fetch)).toEqual([{ kinds: { 'white rum': 'liqueurs' } }])
    expect(await within(dialog).findByText('Liqueurs · used in 2 drinks')).toBeInTheDocument()
  })

  test('moves an item to fresh', async () => {
    let bar = everyday
    const { fetch, dialog } = await openSheet('White rum', everyday, (body) => {
      bar = withItem(bar, 'white rum', body.fresh ? { fresh: true, state: null } : { fresh: false })
      return json(bar)
    })
    const fresh = within(dialog).getByRole('switch', { name: 'Fresh item' })
    expect(fresh).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(fresh)
    await waitFor(() => expect(fresh).toHaveAttribute('aria-checked', 'true'))
    expect(within(dialog).queryByRole('radiogroup', { name: 'In the bar' })).not.toBeInTheDocument()

    fireEvent.click(fresh)
    await waitFor(() => expect(fresh).toHaveAttribute('aria-checked', 'false'))
    expect(posted(fetch)).toEqual([{ fresh: ['white rum'] }, { not_fresh: ['white rum'] }])
  })

  test('folds into another item', async () => {
    const { fetch, dialog } = await openSheet('Mezcal', everyday, () => json(without(everyday, 'mezcal')))
    expect(within(dialog).getByText('Its names and drinks move to the other item, then this one goes.')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Fold into another item' }))
    const picker = within(dialog).getByRole('combobox', { name: 'Fold into' })
    expect(within(picker).queryByRole('option', { name: 'Mezcal' })).not.toBeInTheDocument()
    fireEvent.change(picker, { target: { value: 'white rum' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Fold into White rum' }))
    expect(posted(fetch)).toEqual([{ fold: { mezcal: 'white rum' } }])
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.queryByText('Mezcal')).not.toBeInTheDocument()
  })

  test('deletes an unused item', async () => {
    const { fetch, dialog } = await openSheet('Absinthe', everyday, () => json(without(everyday, 'absinthe')))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete from the bar' }))
    expect(posted(fetch)).toEqual([])
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete Absinthe' }))
    expect(posted(fetch)).toEqual([{ delete: ['absinthe'] }])
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.queryByText('Absinthe')).not.toBeInTheDocument()
  })

  test("explains why a used item can't be deleted", async () => {
    const { dialog } = await openSheet('White rum')
    const remove = within(dialog).getByRole('button', { name: 'Delete from the bar' })
    expect(remove).toBeDisabled()
    expect(remove).toHaveAccessibleDescription('Only items no drink uses can be deleted. 2 drinks use white rum.')
  })

  test('one drink uses it', async () => {
    const { dialog } = await openSheet('Campari')
    expect(within(dialog).getByRole('button', { name: 'Delete from the bar' })).toHaveAccessibleDescription(
      'Only items no drink uses can be deleted. 1 drink uses campari.',
    )
  })

  test('a fresh chip opens its sheet without the bar state', async () => {
    const { dialog } = await openSheet('Lime juice')
    expect(within(dialog).queryByRole('radiogroup', { name: 'In the bar' })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('switch', { name: 'Fresh item' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
