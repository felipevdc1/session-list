// cores.ts: the theme value → tone rule, and the exact palette values (a typo
// in a hex is the likely defect, so every value is spelled out here).

import { describe, expect, test } from 'claude-code/testing'

import { PALETAS, tomDoTema } from '../hooks/cores'

describe('tomDoTema', () => {
  test('values containing "light" are claro', () => {
    expect(tomDoTema('light')).toBe('claro')
    expect(tomDoTema('light-daltonized')).toBe('claro')
    expect(tomDoTema('light-ansi')).toBe('claro')
  })

  test('case does not matter', () => {
    expect(tomDoTema('LIGHT')).toBe('claro')
  })

  test('everything else is escuro, absent included', () => {
    expect(tomDoTema('dark')).toBe('escuro')
    expect(tomDoTema('dark-ansi')).toBe('escuro')
    expect(tomDoTema('auto')).toBe('escuro')
    expect(tomDoTema(null)).toBe('escuro')
    expect(tomDoTema(undefined)).toBe('escuro')
    expect(tomDoTema('')).toBe('escuro')
  })
})

describe('PALETAS', () => {
  test('escuro values are exact', () => {
    expect(PALETAS.escuro).toEqual({
      rosa: '#ff2e93', lima: '#c6ff00', aviso: '#ff9f1c', texto: '#d9dce2', feito: '#a9aeb8', apagado: '#7b8290', fundo: '#15171c',
    })
  })

  test('claro values are exact', () => {
    expect(PALETAS.claro).toEqual({
      rosa: '#c2005f', lima: '#4d7a00', aviso: '#a85a00', texto: '#22262c', feito: '#555b65', apagado: '#6b727d', fundo: '#fafafa',
    })
  })
})
