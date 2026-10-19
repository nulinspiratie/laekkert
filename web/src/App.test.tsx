import { render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { expect, test, vi } from 'vitest'
import App from './App'

const daiquiri = {
  slug: 'daiquiri',
  name: 'Daiquiri',
  side: 'drinks',
  category: 'cocktails',
  time_minutes: 5,
  tags: [],
  marks: ['favourite'],
  image: null,
}

const traybake = {
  format_version: 1,
  slug: 'chicken-leek-traybake',
  side: 'food',
  name: 'Chicken and leek traybake',
  category: 'mains',
  servings: 4,
  time_minutes: 45,
  ingredients: [
    { amount: 600, unit: 'g', item: 'chicken thighs', note: 'boneless', no_scale: false, original: '', g_per_tsp: null },
    { amount: null, unit: 'g', item: 'smoked paprika', note: '', no_scale: false, original: '1 tsp', g_per_tsp: 2.3 },
    { amount: null, unit: 'to taste', item: 'salt', note: '', no_scale: true, original: '', g_per_tsp: null },
  ],
  steps: ['Heat the oven.', 'Roast everything.'],
  source: null,
  tags: [],
  marks: [],
  image: null,
}

function stubFetch(status: number, body: unknown) {
  const fetch = vi.fn(async () => new Response(JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

function Location() {
  const { pathname, search } = useLocation()
  return <output aria-label="location">{pathname + search}</output>
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
      <Location />
    </MemoryRouter>,
  )
}

test('root redirects to the last side used', async () => {
  localStorage.setItem('laekkert.side', 'drinks')
  const fetch = stubFetch(200, { recipes: [daiquiri] })
  renderAt('/')
  await screen.findByRole('link', { name: /Daiquiri/ })
  expect(fetch).toHaveBeenCalledWith('/api/recipes?side=drinks')
})

test('root redirects to the side with its default query', async () => {
  stubFetch(200, { recipes: [] })
  const food = renderAt('/')
  expect(screen.getByLabelText('location')).toHaveTextContent('/food?mark=kid_approved&sort=time')
  food.unmount()

  localStorage.setItem('laekkert.side', 'drinks')
  renderAt('/')
  expect(screen.getByLabelText('location')).toHaveTextContent(/^\/drinks$/)
})

test('root defaults to food when localStorage throws', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('denied')
  })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('denied')
  })
  const fetch = stubFetch(200, { recipes: [] })
  renderAt('/')
  expect(await screen.findByText('No recipes yet.')).toBeInTheDocument()
  expect(fetch).toHaveBeenCalledWith('/api/recipes?side=food')
})

test('unknown side shows not found', async () => {
  const fetch = stubFetch(200, { recipes: [] })
  renderAt('/bar')
  expect(await screen.findByText('Not found')).toBeInTheDocument()
  expect(fetch).not.toHaveBeenCalled()
})

test('detail shows ingredients and steps', async () => {
  const fetch = stubFetch(200, traybake)
  renderAt('/food/chicken-leek-traybake')
  expect(await screen.findByRole('heading', { name: 'Chicken and leek traybake' })).toBeInTheDocument()
  expect(fetch).toHaveBeenCalledWith('/api/recipes/food/chicken-leek-traybake')
  expect(screen.getByText('Serves 4')).toBeInTheDocument()
  expect(screen.getByText('600 g chicken thighs (boneless)')).toBeInTheDocument()
  expect(screen.getByText('salt, to taste')).toBeInTheDocument()
  const steps = screen.getAllByRole('listitem').filter((li) => li.closest('ol'))
  expect(steps.map((li) => li.textContent)).toEqual(['Heat the oven.', 'Roast everything.'])
})

test('detail shows the original amount with a flag when unconverted', async () => {
  stubFetch(200, traybake)
  renderAt('/food/chicken-leek-traybake')
  expect(await screen.findByText(/1 tsp smoked paprika/)).toBeInTheDocument()
  expect(screen.getByTitle('No metric conversion yet')).toBeInTheDocument()
})

test('unknown recipe shows not found', async () => {
  stubFetch(404, { error: 'not found' })
  renderAt('/drinks/nope')
  expect(await screen.findByText('Not found')).toBeInTheDocument()
})
