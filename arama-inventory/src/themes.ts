export const THEME_IDS = ['oak', 'walnut', 'linen', 'gild', 'night'] as const

export type ThemeId = (typeof THEME_IDS)[number]

export type ThemeOption = {
  id: ThemeId
  name: string
  hint: string
  swatchA: string
  swatchB: string
  themeColor: string
}

export const THEMES: ThemeOption[] = [
  {
    id: 'oak',
    name: 'Дуб',
    hint: 'Тёплый цех',
    swatchA: '#e4d7c3',
    swatchB: '#1f5c4d',
    themeColor: '#2a2118',
  },
  {
    id: 'walnut',
    name: 'Орех',
    hint: 'Тёмный лак',
    swatchA: '#3a2a1c',
    swatchB: '#c4a574',
    themeColor: '#1c1410',
  },
  {
    id: 'linen',
    name: 'Лён',
    hint: 'Светлая мастерская',
    swatchA: '#f4f1ea',
    swatchB: '#3d5a80',
    themeColor: '#3d5a80',
  },
  {
    id: 'gild',
    name: 'Позолота',
    hint: 'Бордо и золото',
    swatchA: '#f3e6c8',
    swatchB: '#7a1f2b',
    themeColor: '#5c1520',
  },
  {
    id: 'night',
    name: 'Графит',
    hint: 'Ночной склад',
    swatchA: '#1e242c',
    swatchB: '#c9a227',
    themeColor: '#12161c',
  },
]

const STORAGE_KEY = 'arama-theme'

export function isThemeId(value: string | null): value is ThemeId {
  return THEME_IDS.includes(value as ThemeId)
}

export function readStoredTheme(): ThemeId {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    if (isThemeId(value)) return value
  } catch {
    /* ignore */
  }
  return 'oak'
}

export function applyTheme(id: ThemeId) {
  document.documentElement.dataset.theme = id
  const theme = THEMES.find((item) => item.id === id)
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta && theme) meta.setAttribute('content', theme.themeColor)
  try {
    localStorage.setItem(STORAGE_KEY, id)
  } catch {
    /* ignore */
  }
}
