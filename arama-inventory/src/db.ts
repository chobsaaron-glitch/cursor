import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type {
  CatalogInput,
  CatalogItem,
  MoldingInput,
  MoldingItem,
  SyncSettings,
} from './types'

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
  catalog: {
    key: string
    value: CatalogItem
    indexes: {
      'by-updated': string
    }
  }
  meta: {
    key: string
    value: {
      key: string
      scriptUrl: string
      token: string
      lastSyncAt: string
      autoSync: boolean
    }
  }
}

const DB_NAME = 'arama-inventory'
const DB_VERSION = 2
const SYNC_SETTINGS_KEY = 'syncSettings'

const defaultSyncSettings: SyncSettings = {
  scriptUrl: '',
  token: '',
  lastSyncAt: '',
  autoSync: false,
}

let dbPromise: Promise<IDBPDatabase<AramaDB>> | null = null

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<AramaDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const store = db.createObjectStore('moldings', { keyPath: 'id' })
          store.createIndex('by-cell', 'cell')
          store.createIndex('by-article', 'article')
          store.createIndex('by-created', 'createdAt')
        }
        if (oldVersion < 2) {
          if (!db.objectStoreNames.contains('catalog')) {
            const catalog = db.createObjectStore('catalog', { keyPath: 'article' })
            catalog.createIndex('by-updated', 'updatedAt')
          }
          if (!db.objectStoreNames.contains('meta')) {
            db.createObjectStore('meta', { keyPath: 'key' })
          }
        }
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

function normalizeArticle(article: string) {
  return article.trim()
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
    article: normalizeArticle(input.article),
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
      article: normalizeArticle(String(raw.article ?? '')),
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

export async function replaceMoldings(items: MoldingItem[]): Promise<void> {
  const db = await getDb()
  const tx = db.transaction('moldings', 'readwrite')
  await tx.store.clear()
  for (const item of items) {
    await tx.store.put(item)
  }
  await tx.done
}

export async function listCells(): Promise<string[]> {
  const items = await listMoldings()
  return [...new Set(items.map((i) => i.cell).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, 'ru', { numeric: true }),
  )
}

export async function listCatalog(): Promise<CatalogItem[]> {
  const db = await getDb()
  const items = await db.getAll('catalog')
  return items.sort((a, b) => a.article.localeCompare(b.article, 'ru', { numeric: true }))
}

export async function getCatalogItem(article: string): Promise<CatalogItem | undefined> {
  const db = await getDb()
  const key = normalizeArticle(article)
  if (!key) return undefined
  return (
    (await db.get('catalog', key)) ??
    (await db.get('catalog', key.toUpperCase())) ??
    (await db.get('catalog', key.toLowerCase()))
  )
}

/** Поиск артикула без учёта регистра */
export async function findCatalogByArticle(article: string): Promise<CatalogItem | undefined> {
  const key = normalizeArticle(article)
  if (!key) return undefined
  const exact = await getCatalogItem(key)
  if (exact) return exact
  const all = await listCatalog()
  const lower = key.toLowerCase()
  return all.find((c) => c.article.toLowerCase() === lower)
}

export async function saveCatalogItem(input: CatalogInput): Promise<CatalogItem> {
  const db = await getDb()
  const article = normalizeArticle(input.article)
  if (!article) throw new Error('Артикул обязателен')

  const existing = await findCatalogByArticle(article)
  const item: CatalogItem = {
    article: existing?.article ?? article,
    name: input.name.trim(),
    photoUrl: input.photoUrl.trim(),
    notes: input.notes.trim(),
    updatedAt: nowIso(),
  }

  // если нашли с другим регистром — удаляем старый ключ
  if (existing && existing.article !== item.article) {
    await db.delete('catalog', existing.article)
  }

  await db.put('catalog', item)
  return item
}

export async function deleteCatalogItem(article: string): Promise<void> {
  const db = await getDb()
  const found = await findCatalogByArticle(article)
  if (found) await db.delete('catalog', found.article)
}

export async function replaceCatalog(items: CatalogItem[]): Promise<void> {
  const db = await getDb()
  const tx = db.transaction('catalog', 'readwrite')
  await tx.store.clear()
  for (const raw of items) {
    if (!raw?.article) continue
    await tx.store.put({
      article: normalizeArticle(String(raw.article)),
      name: String(raw.name ?? '').trim(),
      photoUrl: String(raw.photoUrl ?? '').trim(),
      notes: String(raw.notes ?? '').trim(),
      updatedAt: String(raw.updatedAt ?? nowIso()),
    })
  }
  await tx.done
}

export async function getSyncSettings(): Promise<SyncSettings> {
  const db = await getDb()
  const row = (await db.get('meta', SYNC_SETTINGS_KEY)) as
    | (SyncSettings & { key: string })
    | undefined
  if (!row) return { ...defaultSyncSettings }
  return {
    scriptUrl: String(row.scriptUrl ?? ''),
    token: String(row.token ?? ''),
    lastSyncAt: String(row.lastSyncAt ?? ''),
    autoSync: Boolean(row.autoSync),
  }
}

export async function saveSyncSettings(settings: SyncSettings): Promise<void> {
  const db = await getDb()
  await db.put('meta', {
    key: SYNC_SETTINGS_KEY,
    scriptUrl: settings.scriptUrl,
    token: settings.token,
    lastSyncAt: settings.lastSyncAt,
    autoSync: settings.autoSync,
  })
}
