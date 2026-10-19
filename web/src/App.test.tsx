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
