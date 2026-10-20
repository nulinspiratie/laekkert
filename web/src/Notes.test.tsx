import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { Notes } from './Notes'

afterEach(cleanup)

describe('Notes', () => {
  test('blank text renders nothing', () => {
    const { container } = render(<Notes text="" />)
    expect(container).toBeEmptyDOMElement()
    cleanup()
    const spaces = render(<Notes text={'  \n '} />)
    expect(spaces.container).toBeEmptyDOMElement()
  })

  test('a titled section with paragraphs, line breaks and a list', () => {
    const { container } = render(<Notes text={'one\ntwo\n\n- a\n- b'} />)
    const section = screen.getByRole('region', { name: 'Notes' })
    expect(section).toHaveClass('notes')
    expect(screen.getByRole('heading', { name: 'Notes', level: 2 })).toBeInTheDocument()
    const paragraphs = container.querySelectorAll('p')
    expect(paragraphs).toHaveLength(1)
    expect(paragraphs[0].innerHTML).toBe('one<br>two')
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['a', 'b'])
  })

  test('bold and italics become strong and em', () => {
    const { container } = render(<Notes text="**hot** and *soft* and ***both***" />)
    expect(container.querySelector('strong')).toHaveTextContent('hot')
    expect(container.querySelector('em')).toHaveTextContent('soft')
    expect(container.querySelector('strong em, em strong')).toHaveTextContent('both')
  })

  test('markup in the text is shown as text, never built', () => {
    const { container } = render(<Notes text={'<b>hi</b>\n<img src=x onerror=alert(1)>'} />)
    expect(container.querySelector('b')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(container).toHaveTextContent('<b>hi</b>')
    expect(container).toHaveTextContent('<img src=x onerror=alert(1)>')
  })
})
