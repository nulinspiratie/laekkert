import { expect, test, vi } from 'vitest'
import { getLastSide, getUnitMode, getView, setLastSide, setUnitMode, setView } from './prefs'

test('defaults when nothing is stored', () => {
  expect(getLastSide()).toBe('food')
  expect(getView()).toBe('grid')
  expect(getUnitMode()).toBe('spoons')
})

test('preferences round-trip under their own keys', () => {
  setLastSide('drinks')
  setView('list')
  setUnitMode('metric')
  expect(getLastSide()).toBe('drinks')
  expect(getView()).toBe('list')
  expect(getUnitMode()).toBe('metric')
  expect(localStorage.getItem('laekkert.side')).toBe('drinks')
  expect(localStorage.getItem('laekkert.view')).toBe('list')
  expect(localStorage.getItem('laekkert.units')).toBe('metric')
})

test('unknown stored values fall back to the defaults', () => {
  localStorage.setItem('laekkert.side', 'bar')
  localStorage.setItem('laekkert.view', 'table')
  localStorage.setItem('laekkert.units', 'cups')
  expect(getLastSide()).toBe('food')
  expect(getView()).toBe('grid')
  expect(getUnitMode()).toBe('spoons')
})

test('falls back to the defaults and does not throw when localStorage throws', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('denied')
  })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('denied')
  })
  expect(getLastSide()).toBe('food')
  expect(getView()).toBe('grid')
  expect(getUnitMode()).toBe('spoons')
  expect(() => {
    setLastSide('drinks')
    setView('list')
    setUnitMode('metric')
  }).not.toThrow()
})
