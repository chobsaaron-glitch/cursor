import { getSyncSettings, listCatalog, listMoldings, replaceCatalog, replaceMoldings, saveSyncSettings } from './db'
import type { CatalogItem, MoldingItem, SyncPayload, SyncSettings } from './types'

export type SyncResult = {
  catalogCount: number
  moldingsCount: number
  syncedAt: string
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
    syncedAt,
  }
}

export async function pushToSheets(): Promise<SyncResult> {
  const settings = await getSyncSettings()
  assertConfigured(settings)

  const [catalog, moldings] = await Promise.all([listCatalog(), listMoldings()])
  await postToScript(settings, {
    action: 'push',
    catalog,
    moldings,
  })

  const syncedAt = new Date().toISOString()
  await saveSyncSettings({ ...settings, lastSyncAt: syncedAt })

  return {
    catalogCount: catalog.length,
    moldingsCount: moldings.length,
    syncedAt,
  }
}

/** Двусторонняя синхронизация: сервер мержит по updatedAt, возвращает итоговые данные */
export async function syncBidirectional(): Promise<SyncResult> {
  const settings = await getSyncSettings()
  assertConfigured(settings)

  const [catalog, moldings] = await Promise.all([listCatalog(), listMoldings()])
  const payload: SyncPayload = { catalog, moldings }

  const data = await postToScript(settings, {
    action: 'sync',
    ...payload,
  })

  const nextCatalog = Array.isArray(data.catalog) ? (data.catalog as CatalogItem[]) : catalog
  const nextMoldings = Array.isArray(data.moldings) ? (data.moldings as MoldingItem[]) : moldings

  await replaceCatalog(nextCatalog)
  await replaceMoldings(nextMoldings)

  const syncedAt = new Date().toISOString()
  await saveSyncSettings({ ...settings, lastSyncAt: syncedAt })

  return {
    catalogCount: nextCatalog.length,
    moldingsCount: nextMoldings.length,
    syncedAt,
  }
}
