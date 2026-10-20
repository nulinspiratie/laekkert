import { Navigate, Route, Routes, useParams } from 'react-router'
import { defaultQuery } from './browse'
import Browse from './Browse'
import { getLastSide } from './prefs'
import { RecipeView } from './RecipeView'
import { isSide } from './types'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/:side" element={<SidePage />} />
      <Route path="/:side/:slug" element={<RecipePage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}

function Home() {
  const side = getLastSide()
  const query = defaultQuery(side)
  return <Navigate to={`/${side}${query ? `?${query}` : ''}`} replace />
}

function NotFound() {
  return <p>Not found</p>
}

function SidePage() {
  const { side } = useParams()
  if (!isSide(side)) return <NotFound />
  return <Browse key={side} side={side} />
}

function RecipePage() {
  const { side, slug } = useParams()
  if (!isSide(side) || !slug) return <NotFound />
  return <RecipeView key={`${side}/${slug}`} side={side} slug={slug} />
}
