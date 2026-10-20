// The design's SVG icons (docs/design/artboards), as components. All are
// decorative (aria-hidden) unless given an aria-label, which makes them
// role="img". They draw in currentColor.

import type { ReactNode, SVGProps } from 'react'

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'ref'> {
  size?: number
}

interface BaseProps extends IconProps {
  box?: number
  children: ReactNode
}

function Svg({ size = 20, box = 24, strokeWidth = 1.75, children, ...rest }: BaseProps) {
  const labelled = rest['aria-label'] !== undefined
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${box} ${box}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={labelled ? 'img' : undefined}
      aria-hidden={labelled ? undefined : true}
      {...rest}
    >
      {children}
    </svg>
  )
}

export function Logo(props: IconProps) {
  return (
    <Svg size={28} {...props}>
      <path d="M3 10h18v10H3z" />
      <path d="M6 10V5h12v5" />
      <path d="M9 7.5h6" />
    </Svg>
  )
}

/** The bowl on the Food tab. */
export function FoodTab(props: IconProps) {
  return (
    <Svg size={18} {...props}>
      <path d="M4 10h16v7a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z" />
      <path d="M2 10h2M20 10h2M10 6h4" />
    </Svg>
  )
}

/** The cocktail glass on the Drinks tab. */
export function DrinksTab(props: IconProps) {
  return (
    <Svg size={18} {...props}>
      <path d="M5 5h14l-7 8z" />
      <path d="M12 13v6M8 19h8" />
    </Svg>
  )
}

export function Search(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </Svg>
  )
}

export function Filters(props: IconProps) {
  return (
    <Svg size={22} {...props}>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </Svg>
  )
}

export function Grid(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </Svg>
  )
}

export function List(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.5M4.5 12h.5M4.5 18h.5" />
    </Svg>
  )
}

/** Marks drawn as a solid shape when `filled` (a mark that is set). */
export function Heart({ filled, ...props }: IconProps & { filled?: boolean }) {
  return (
    <Svg {...(filled ? { fill: 'currentColor', strokeWidth: 1.5 } : {})} {...props}>
      <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />
    </Svg>
  )
}

export function Bookmark({ filled, ...props }: IconProps & { filled?: boolean }) {
  return (
    <Svg {...(filled ? { fill: 'currentColor', strokeWidth: 1.5 } : {})} {...props}>
      <path d="M7 4h10v16l-5-3.5L7 20z" />
    </Svg>
  )
}

/** The rating star; solid when `filled` (a rating shown on a card). */
export function Star({ filled, ...props }: IconProps & { filled?: boolean }) {
  return (
    <Svg {...(filled ? { fill: 'currentColor', strokeWidth: 1.5 } : {})} {...props}>
      <path d="m12 4 2.4 5 5.4.6-4 3.7 1.1 5.3L12 16l-4.9 2.6 1.1-5.3-4-3.7 5.4-.6z" />
    </Svg>
  )
}

/** A star drawn empty, half or full: `fraction` is 0, 0.5 or 1 of its width in the star colour. */
export function StarFraction({ fraction, size = 24 }: { fraction: number; size?: number }) {
  return (
    <span className="star-fraction" style={{ width: size, height: size }} aria-hidden="true">
      <Star size={size} />
      <span className="star-fraction-fill" style={{ width: `${fraction * 100}%` }}>
        <Star filled size={size} />
      </span>
    </span>
  )
}

export function Edit(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 20h4L19 9l-4-4L4 16z" />
      <path d="m13.5 6.5 4 4" />
    </Svg>
  )
}

export function Restore(props: IconProps) {
  return (
    <Svg size={18} {...props}>
      <path d="M4 12a8 8 0 1 0 2.5-5.8" />
      <path d="M4 4v4h4" />
    </Svg>
  )
}

export function Note(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 4h12v16H6z" />
      <path d="M9 9h6M9 13h6M9 17h3" />
    </Svg>
  )
}

export function Clock(props: IconProps) {
  return (
    <Svg size={16} {...props}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l2.5 2" />
    </Svg>
  )
}

export function People(props: IconProps) {
  return (
    <Svg size={18} {...props}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
      <circle cx="17" cy="9" r="2.4" />
      <path d="M15.5 14.2A4.5 4.5 0 0 1 21 18.5" />
    </Svg>
  )
}

export function Back({ strokeWidth = 2, ...props }: IconProps) {
  return (
    <Svg size={22} strokeWidth={strokeWidth} {...props}>
      <path d="m15 6-6 6 6 6" />
    </Svg>
  )
}

export function Chevron(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m9 6 6 6-6 6" />
    </Svg>
  )
}

export function Plus({ strokeWidth = 2.25, ...props }: IconProps) {
  return (
    <Svg size={18} strokeWidth={strokeWidth} {...props}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  )
}

export function Minus({ strokeWidth = 2.25, ...props }: IconProps) {
  return (
    <Svg size={18} strokeWidth={strokeWidth} {...props}>
      <path d="M5 12h14" />
    </Svg>
  )
}

export function Check({ strokeWidth = 2.25, ...props }: IconProps) {
  return (
    <Svg size={18} strokeWidth={strokeWidth} {...props}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </Svg>
  )
}

export function Close({ strokeWidth = 2, ...props }: IconProps) {
  return (
    <Svg size={16} strokeWidth={strokeWidth} {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  )
}

// Photo-less tile glyphs: 48 x 48 boxes drawn at 1.5.

function Glyph(props: IconProps & { children: ReactNode }) {
  return <Svg size={64} box={48} strokeWidth={1.5} {...props} />
}

export function Bowl(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M7 22h34a17 17 0 0 1-34 0z" />
      <path d="M18 39h12" />
      <path d="M19 16c0-3 3-3 3-6M26 16c0-3 3-3 3-6" />
    </Glyph>
  )
}

export function Pot(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M10 18h28v15a7 7 0 0 1-7 7H17a7 7 0 0 1-7-7z" />
      <path d="M5 18h5M38 18h5M19 13h10M24 13v-3" />
    </Glyph>
  )
}

export function Plate(props: IconProps) {
  return (
    <Glyph {...props}>
      <circle cx="24" cy="25" r="12" />
      <circle cx="24" cy="25" r="7" />
      <path d="M6 12v7a3 3 0 0 0 3 3v15M9 12v7M42 12c-3 0-4 4-4 9h4v16" />
    </Glyph>
  )
}

export function Rocks(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M12 15h24l-2.2 23H14.2z" />
      <rect x="17" y="24" width="9" height="8" rx="1.5" />
      <path d="M13 21h22" />
    </Glyph>
  )
}

export function Highball(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M16 10h16l-1.6 30H17.6z" />
      <path d="M17 17h14" />
      <path d="M29 4l-4 20" />
    </Glyph>
  )
}

export function Coupe(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M9 14h30c0 8-6.5 13-15 13S9 22 9 14z" />
      <path d="M24 27v11M17 38h14" />
    </Glyph>
  )
}

// The bar (BarPhone, BarDesktop, BarItemSheetPhone).

/** "Don't have": a circle with a bar through it. */
export function MinusCircle({ strokeWidth = 2.25, ...props }: IconProps) {
  return (
    <Svg size={16} strokeWidth={strokeWidth} {...props}>
      <circle cx="12" cy="12" r="8" />
      <path d="M8.5 12h7" />
    </Svg>
  )
}

/** Fresh items: bought when needed. */
export function Basket({ strokeWidth = 1.9, ...props }: IconProps) {
  return (
    <Svg strokeWidth={strokeWidth} {...props}>
      <path d="M4 10h16l-1.5 9h-13z" />
      <path d="m8 10 3-5M16 10l-3-5" />
    </Svg>
  )
}

/** The "⋯" button. */
export function More(props: IconProps) {
  return (
    <Svg fill="currentColor" stroke="none" {...props}>
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </Svg>
  )
}

/** Not sorted yet. */
export function Question({ strokeWidth = 1.9, ...props }: IconProps) {
  return (
    <Svg size={22} strokeWidth={strokeWidth} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.4" />
      <circle cx="12" cy="17" r=".9" fill="currentColor" stroke="none" />
    </Svg>
  )
}

/** No bottle by that name. */
export function Bottle({ strokeWidth = 1.25, ...props }: IconProps) {
  return (
    <Svg size={56} strokeWidth={strokeWidth} {...props}>
      <path d="M10 3h4v4l1.5 2.5V20a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1V9.5L10 7z" />
      <path d="M8.5 13h7" />
    </Svg>
  )
}

/** Fold one item into another. */
export function Fold(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 5v4a4 4 0 0 0 4 4h10" />
      <path d="m15 9 4 4-4 4" />
    </Svg>
  )
}
