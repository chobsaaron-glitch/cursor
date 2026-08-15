import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { MoldingInput, MoldingItem } from './types'

interface AramaDB extends DBSchema {
  moldings: {
    key: string
    value: MoldingItem
    indexes: {
      'by-cell': string
      'by-article': string
      'by-created': string
    }
  }
}

const DB_NAME = 'arama-inventory'
const DB_VERSION = 1

let dbPromise: Promise<IDBPDatabase<AramaDB>> | null = null

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<AramaDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const store = db.createObjectStore('moldings', { keyPath: 'id' })
        store.createIndex('by-cell', 'cell')
        store.createIndex('by-article', 'article')
        store.createIndex('by-created', 'createdAt')
      },
    })
  }
  return dbPromise
}

function nowIso() {
  return new Date().toISOString()
}

function createId() {
  return crypto.randomUUID()
}

export async function listMoldings(): Promise<MoldingItem[]> {
  const db = await getDb()
  const items = await db.getAll('moldings')
  return items.sort((a, b) => {
    const cellCmp = a.cell.localeCompare(b.cell, 'ru', { numeric: true })
    if (cellCmp !== 0) return cellCmp
    return a.article.localeCompare(b.article, 'ru')
  })
}

export async function getMolding(id: string): Promise<MoldingItem | undefined> {
  const db = await getDb()
  return db.get('moldings', id)
}

export async function saveMolding(input: MoldingInput): Promise<MoldingItem> {
  const db = await getDb()
  const existing = input.id ? await db.get('moldings', input.id) : undefined
  const stamp = nowIso()

  const item: MoldingItem = {
    id: existing?.id ?? input.id ?? createId(),
    cell: input.cell.trim(),
    article: input.article.trim(),
    lengthCm: Number(input.lengthCm) || 0,
    quantity: Math.max(0, Math.floor(Number(input.quantity) || 0)),
    photoUrl: input.photoUrl.trim(),
    comment: input.comment.trim(),
    createdAt: existing?.createdAt ?? input.createdAt ?? stamp,
    updatedAt: stamp,
  }

  await db.put('moldings', item)
  return item
}

export async function deleteMolding(id: string): Promise<void> {
  const db = await getDb()
  await db.delete('moldings', id)
}

export async function adjustQuantity(id: string, delta: number): Promise<MoldingItem | undefined> {
  const item = await getMolding(id)
  if (!item) return undefined
  return saveMolding({
    ...item,
    quantity: Math.max(0, item.quantity + delta),
  })
}

export async function exportAll(): Promise<MoldingItem[]> {
  return listMoldings()
}

export async function importAll(
  items: MoldingItem[],
  mode: 'replace' | 'merge' = 'merge',
): Promise<number> {
  const db = await getDb()
  const tx = db.transaction('moldings', 'readwrite')
  if (mode === 'replace') {
    await tx.store.clear()
  }
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue
    const item: MoldingItem = {
      id: String(raw.id || createId()),
      cell: String(raw.cell ?? '').trim(),
      article: String(raw.article ?? '').trim(),
      lengthCm: Number(raw.lengthCm) || 0,
      quantity: Math.max(0, Math.floor(Number(raw.quantity) || 0)),
      photoUrl: String(raw.photoUrl ?? '').trim(),
      comment: String(raw.comment ?? '').trim(),
      createdAt: String(raw.createdAt ?? nowIso()),
      updatedAt: nowIso(),
    }
    await tx.store.put(item)
  }
  await tx.done
  return items.length
}

export async function listCells(): Promise<string[]> {
  const items = await listMoldings()
  return [...new Set(items.map((i) => i.cell).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, 'ru', { numeric: true }),
  )
}
