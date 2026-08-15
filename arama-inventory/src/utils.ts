import type { Filters, MoldingItem } from './types'

export function formatDate(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

export function formatDateTime(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatLength(cm: number): string {
  if (!cm && cm !== 0) return '—'
  const meters = cm / 100
  if (Number.isInteger(meters) || Math.abs(meters - Math.round(meters * 10) / 10) < 0.001) {
    return `${cm} см (${meters.toFixed(meters % 1 === 0 ? 0 : 1)} м)`
  }
  return `${cm} см`
}

export function filterMoldings(items: MoldingItem[], filters: Filters): MoldingItem[] {
  const q = filters.query.trim().toLowerCase()
  return items.filter((item) => {
    if (filters.cell && item.cell !== filters.cell) return false
    if (!q) return true
    const hay = [item.article, item.cell, item.comment, String(item.lengthCm), item.photoUrl]
      .join(' ')
      .toLowerCase()
    return hay.includes(q)
  })
}

export function summarizeStock(items: MoldingItem[]) {
  const totalPieces = items.reduce((sum, i) => sum + i.quantity, 0)
  const totalMeters = items.reduce((sum, i) => sum + (i.lengthCm * i.quantity) / 100, 0)
  const cells = new Set(items.map((i) => i.cell).filter(Boolean)).size
  return { totalPieces, totalMeters, cells, skuCount: items.length }
}

export function isLikelyImageUrl(url: string): boolean {
  if (!url) return false
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}
