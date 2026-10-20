// A recipe's picture, or the accent tile with a glyph for its category.

import type { ReactElement } from 'react'
import { recipeImageUrl } from './api'
import { Bowl, Coupe, Highball, Plate, Pot, Rocks, type IconProps } from './icons'
import type { Side } from './types'

type Glyph = (props: IconProps) => ReactElement

const GLYPHS: Record<Side, Record<string, Glyph>> = {
  food: { mains: Plate, sides: Bowl, desserts: Bowl, sauces: Pot, prep: Pot },
  drinks: { cocktails: Coupe, mocktails: Highball, syrups: Rocks, prep: Rocks },
}

export type TileSize = 'card' | 'row' | 'hero'

export interface PhotoTileProps {
  side: Side
  slug: string
  category: string
  image: string | null
  /** card: the 4:3 top of a grid card. row: the small square of a list row. hero: fills the recipe page's hero box. */
  size: TileSize
}

export function PhotoTile({ side, slug, category, image, size }: PhotoTileProps) {
  if (image) {
    // The recipe's name is shown beside the picture, so the picture is decoration.
    return (
      <div className={`photo-tile photo-tile--${size}`}>
        <img
          src={recipeImageUrl(side, slug, image)}
          alt=""
          loading={size === 'hero' ? 'eager' : 'lazy'}
        />
      </div>
    )
  }
  const Glyph = GLYPHS[side][category] ?? Plate
  // A row tile draws the 48-unit glyph at half size, so it gets a heavier stroke.
  return (
    <div className={`photo-tile photo-tile--${size} photo-tile--plain`}>
      <Glyph strokeWidth={size === 'row' ? 2.25 : 1.5} />
    </div>
  )
}
