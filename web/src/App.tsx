import { useEffect, useState } from 'react'
import { Link, Navigate, Route, Routes, useParams } from 'react-router'
import { getRecipe, listRecipes } from './api'
import { getLastSide, setLastSide } from './lastSide'
import { isSide, type Ingredient, type Recipe, type RecipeSummary, type Side } from './types'

const SIDE_LABELS: Record<Side, string> = { food: 'Food', drinks: 'Drinks' }

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to={`/${getLastSide()}`} replace />} />
      <Route path="/:side" element={<SidePage />} />
      <Route path="/:side/:slug" element={<RecipePage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}

function NotFound() {
  return <p>Not found</p>
}

function SideSwitch({ current }: { current: Side }) {
  return (
    <nav>
      {(Object.keys(SIDE_LABELS) as Side[]).map((side) => (
        <Link key={side} to={`/${side}`} aria-current={side === current ? 'page' : undefined}>
          {SIDE_LABELS[side]}
        </Link>
      ))}
    </nav>
  )
}

function SidePage() {
  const { side } = useParams()
  if (!isSide(side)) return <NotFound />
  return <RecipeList key={side} side={side} />
}

function RecipeList({ side }: { side: Side }) {
  const [recipes, setRecipes] = useState<RecipeSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLastSide(side)
    let live = true
    listRecipes(side).then(
      (list) => live && setRecipes(list),
      (err: Error) => live && setError(err.message),
    )
    return () => {
      live = false
    }
  }, [side])

  return (
    <main>
      <SideSwitch current={side} />
      {error && <p role="alert">{error}</p>}
      {recipes?.length === 0 && <p>No recipes yet.</p>}
      {recipes && recipes.length > 0 && (
        <ul>
          {recipes.map((r) => (
            <li key={r.slug}>
              <Link to={`/${side}/${r.slug}`}>{r.name}</Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
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
    <main>
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
    </main>
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
