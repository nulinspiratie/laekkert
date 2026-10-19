import { useEffect, useState } from 'react'
import { Link, Navigate, Route, Routes, useParams } from 'react-router'
import { getRecipe } from './api'
import { defaultQuery } from './browse'
import Browse from './Browse'
import { getLastSide } from './prefs'
import { Shell } from './Shell'
import { SIDE_LABELS, isSide, type Ingredient, type Recipe, type Side } from './types'

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
  return <RecipeDetail key={`${side}/${slug}`} side={side} slug={slug} />
}

function RecipeDetail({ side, slug }: { side: Side; slug: string }) {
  // undefined while loading, null when the API says 404.
  const [recipe, setRecipe] = useState<Recipe | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    getRecipe(side, slug).then(
      (r) => live && setRecipe(r),
      (err: Error) => live && setError(err.message),
    )
    return () => {
      live = false
    }
  }, [side, slug])

  if (error) return <p role="alert">{error}</p>
  if (recipe === null) return <NotFound />
  if (recipe === undefined) return null
  return (
    <Shell side={side}>
      <Link to={`/${side}`}>← {SIDE_LABELS[side]}</Link>
      <h1>{recipe.name}</h1>
      <p>Serves {recipe.servings}</p>
      <ul>
        {recipe.ingredients.map((ing, i) => (
          <li key={i}>
            <IngredientLine ingredient={ing} />
          </li>
        ))}
      </ul>
      <ol>
        {recipe.steps.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>
    </Shell>
  )
}

function IngredientLine({ ingredient: ing }: { ingredient: Ingredient }) {
  const note = ing.note ? ` (${ing.note})` : ''
  if (ing.amount === null && ing.original) {
    return (
      <>
        {`${ing.original} ${ing.item}${note}`}{' '}
        <span title="No metric conversion yet" aria-label="No metric conversion yet">
          *
        </span>
      </>
    )
  }
  if (ing.amount === null) return <>{`${ing.item}, ${ing.unit}${note}`}</>
  return <>{`${ing.amount} ${ing.unit} ${ing.item}${note}`}</>
}
