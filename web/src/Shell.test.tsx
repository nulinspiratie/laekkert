import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { expect, test, vi } from 'vitest'
import { PageHeading, Shell } from './Shell'

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

function renderShell(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

test('sets data-side on its root and on the document', () => {
  const { container } = renderShell(
    <Shell side="drinks">
      <p>page</p>
    </Shell>,
  )
  expect(container.firstElementChild).toHaveAttribute('data-side', 'drinks')
  expect(document.documentElement).toHaveAttribute('data-side', 'drinks')
  expect(screen.getByText('page')).toBeInTheDocument()
})

test('nav links go to each side with its default query', () => {
  renderShell(<Shell side="food">{null}</Shell>)
  const nav = screen.getByRole('navigation', { name: 'Food or drinks' })
  expect(nav).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Food' })).toHaveAttribute(
    'href',
    '/food?sort=time',
  )
  expect(screen.getByRole('link', { name: 'Drinks' })).toHaveAttribute('href', '/drinks')
})

test('the current side is marked aria-current', () => {
  renderShell(<Shell side="drinks">{null}</Shell>)
  expect(screen.getByRole('link', { name: 'Drinks' })).toHaveAttribute('aria-current', 'page')
  expect(screen.getByRole('link', { name: 'Food' })).not.toHaveAttribute('aria-current')
})

test('the desktop header has the brand', () => {
  stubViewport(true)
  renderShell(<Shell side="food">{null}</Shell>)
  expect(screen.getByRole('link', { name: 'Lækkert' })).toHaveAttribute('href', '/')
})

test('the view toggle renders only when view and onView are both given', () => {
  stubViewport(true)
  const { rerender } = renderShell(<Shell side="food">{null}</Shell>)
  expect(screen.queryByRole('group', { name: 'View mode' })).not.toBeInTheDocument()

  const onView = vi.fn()
  rerender(
    <MemoryRouter>
      <Shell side="food" view="grid">
        {null}
      </Shell>
    </MemoryRouter>,
  )
  expect(screen.queryByRole('group', { name: 'View mode' })).not.toBeInTheDocument()

  rerender(
    <MemoryRouter>
      <Shell side="food" view="grid" onView={onView}>
        {null}
      </Shell>
    </MemoryRouter>,
  )
  expect(screen.getByRole('button', { name: 'Grid view' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: 'List view' })).toHaveAttribute('aria-pressed', 'false')
  fireEvent.click(screen.getByRole('button', { name: 'List view' }))
  expect(onView).toHaveBeenCalledWith('list')
})

test('on a phone the nav sits in a bottom bar with the page actions and no header', () => {
  stubViewport(false)
  renderShell(
    <Shell
      side="food"
      view="grid"
      onView={() => {}}
      phoneActions={<button aria-label="Filters">f</button>}
    >
      {null}
    </Shell>,
  )
  expect(screen.getByRole('button', { name: 'Filters' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Food' })).toHaveAttribute('aria-current', 'page')
  expect(screen.queryByRole('link', { name: 'Lækkert' })).not.toBeInTheDocument()
  expect(screen.queryByRole('group', { name: 'View mode' })).not.toBeInTheDocument()
})

test('phoneBar={false} leaves a phone with no bottom bar', () => {
  stubViewport(false)
  renderShell(
    <Shell side="food" phoneBar={false}>
      <p>page</p>
    </Shell>,
  )
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  expect(screen.getByText('page')).toBeInTheDocument()
})

test('the Drinks heading carries the bar eyebrow, Food does not', () => {
  const { rerender } = renderShell(<PageHeading side="drinks" title="Drinks" />)
  expect(screen.getByRole('heading', { name: 'Drinks' })).toBeInTheDocument()
  expect(screen.getByText('The bar')).toBeInTheDocument()
  rerender(
    <MemoryRouter>
      <PageHeading side="food" title="Food" subtitle="Favourite, quickest first">
        <button>Sort</button>
      </PageHeading>
    </MemoryRouter>,
  )
  expect(screen.queryByText('The bar')).not.toBeInTheDocument()
  expect(screen.getByText('Favourite, quickest first')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Sort' })).toBeInTheDocument()
})
