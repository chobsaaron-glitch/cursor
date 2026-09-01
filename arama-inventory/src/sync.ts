import {
  clearSentDeletes,
  getPendingDeletes,
  getSyncSettings,
  listChangedCatalog,
  listChangedMoldings,
  listCatalog,
  listMoldings,
  replaceCatalog,
  replaceMoldings,
  saveSyncSettings,
  upsertCatalog,
  upsertMoldings,
} from './db'
import type { CatalogItem, MoldingItem, SyncSettings } from './types'

export type SyncResult = {
  catalogCount: number
  moldingsCount: number
  sentCatalog: number
  sentMoldings: number
  syncedAt: string
}

export type SyncStatus = 'idle' | 'syncing' | 'error'

export type SyncState = {
  status: SyncStatus
  message: string
  lastSyncAt: string
}

type JobKind = 'sync' | 'pull' | 'push'

const listeners = new Set<(state: SyncState) => void>()

let state: SyncState = { status: 'idle', message: '', lastSyncAt: '' }
let running = false
let queuedKind: JobKind | null = null

function emit(next: Partial<SyncState>) {
  state = { ...state, ...next }
  for (const listener of listeners) listener(state)
}

export function getSyncState(): SyncState {
  return state
}

export function subscribeSync(listener: (state: SyncState) => void): () => void {
  listeners.add(listener)
  listener(state)
  return () => {
    listeners.delete(listener)
  }
}

function assertConfigured(settings: SyncSettings) {
  if (!settings.scriptUrl.trim()) {
    throw new Error('Укажите URL веб-приложения Google Apps Script')
  }
  if (!settings.token.trim()) {
    throw new Error('Укажите секретный токен синхронизации')
  }
}

async function postToScript(settings: SyncSettings, body: Record<string, unknown>) {
  const res = await fetch(settings.scriptUrl.trim(), {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      token: settings.token.trim(),
      ...body,
    }),
  })

  const text = await res.text()
  let data: Record<string, unknown>
  try {
    data = JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new Error('Ответ Google Таблиц не похож на JSON. Проверьте URL скрипта.')
  }

  if (!res.ok || data.ok === false) {
    throw new Error(String(data.error || `Ошибка синхронизации (${res.status})`))
  }
  return data
}

export async function pullFromSheets(): Promise<SyncResult> {
  const settings = await getSyncSettings()
  assertConfigured(settings)

  const data = await postToScript(settings, { action: 'pull' })
  const catalog = Array.isArray(data.catalog) ? (data.catalog as CatalogItem[]) : []
  const moldings = Array.isArray(data.moldings) ? (data.moldings as MoldingItem[]) : []

  await replaceCatalog(catalog)
  await replaceMoldings(moldings)

  const syncedAt = new Date().toISOString()
  await saveSyncSettings({ ...settings, lastSyncAt: syncedAt })

  return {
    catalogCount: catalog.length,
    moldingsCount: moldings.length,
    sentCatalog: 0,
    sentMoldings: 0,
    syncedAt,
  }
}

export async function pushToSheets(): Promise<SyncResult> {
  const settings = await getSyncSettings()
  assertConfigured(settings)

  const [catalog, moldings] = await Promise.all([listCatalog(), listMoldings()])
  const data = await postToScript(settings, {
    action: 'push',
    catalog,
    moldings,
  })

  const syncedAt = new Date().toISOString()
  await saveSyncSettings({ ...settings, lastSyncAt: syncedAt })
  await clearSentDeletes(await getPendingDeletes())

  return {
    catalogCount: Number(data.catalogCount) || catalog.length,
    moldingsCount: Number(data.moldingsCount) || moldings.length,
    sentCatalog: catalog.length,
    sentMoldings: moldings.length,
    syncedAt,
  }
}

/** Дельта: на сервер уходят только изменённые с прошлой синхронизации записи. */
export async function syncBidirectional(): Promise<SyncResult> {
  const settings = await getSyncSettings()
  assertConfigured(settings)

  const collectedAt = new Date().toISOString()
  const since = settings.lastSyncAt
  const [catalog, moldings, deletes] = await Promise.all([
    listChangedCatalog(since),
    listChangedMoldings(since),
    getPendingDeletes(),
  ])

  const data = await postToScript(settings, {
    action: 'sync',
    since,
    catalog,
    moldings,
    deletedMoldings: deletes.moldings,
    deletedCatalog: deletes.catalog,
  })

  const incomingCatalog = Array.isArray(data.catalog) ? (data.catalog as CatalogItem[]) : []
  const incomingMoldings = Array.isArray(data.moldings) ? (data.moldings as MoldingItem[]) : []

  await Promise.all([upsertCatalog(incomingCatalog), upsertMoldings(incomingMoldings)])
  await clearSentDeletes(deletes)
  await saveSyncSettings({ ...settings, lastSyncAt: collectedAt })

  return {
    catalogCount: Number(data.catalogCount) || 0,
    moldingsCount: Number(data.moldingsCount) || 0,
    sentCatalog: catalog.length,
    sentMoldings: moldings.length,
    syncedAt: collectedAt,
  }
}

async function runJob(kind: JobKind): Promise<SyncResult> {
  if (kind === 'pull') return pullFromSheets()
  if (kind === 'push') return pushToSheets()
  return syncBidirectional()
}

async function pumpQueue() {
  if (running) return
  running = true
  emit({ status: 'syncing', message: 'Синхронизация в фоне…' })

  try {
    while (queuedKind) {
      const kind = queuedKind
      queuedKind = null
      const result = await runJob(kind)
      emit({
        status: queuedKind ? 'syncing' : 'idle',
        lastSyncAt: result.syncedAt,
        message:
          kind === 'sync'
            ? `Отправлено: ${result.sentMoldings} остатков, ${result.sentCatalog} артикулов`
            : `Готово: справочник ${result.catalogCount}, остатки ${result.moldingsCount}`,
      })
    }
  } catch (err) {
    emit({
      status: 'error',
      message: err instanceof Error ? err.message : 'Ошибка синхронизации',
    })
  } finally {
    running = false
    if (queuedKind) void pumpQueue()
  }
}

/** Поставить синхронизацию в очередь: форма и склад не ждут ответа таблиц. */
export function queueBackgroundSync(kind: JobKind = 'sync') {
  if (kind !== 'sync' || queuedKind !== 'pull' && queuedKind !== 'push') {
    queuedKind = kind
  }
  emit({ status: 'syncing', message: 'Синхронизация в фоне…' })
  void pumpQueue()
}
