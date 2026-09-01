/**
 * А-рама — синхронизация с Google Таблицами (быстрый режим)
 *
 * 1. Создайте Google Таблицу (или откройте существующую).
 * 2. Расширения → Apps Script → вставьте этот код.
 * 3. В SYNC_TOKEN укажите свой секретный пароль.
 * 4. Развернуть → Новое развёртывание → Тип: веб-приложение
 *    - Выполнять от имени: меня
 *    - Доступ: все пользователи
 * 5. Скопируйте URL веб-приложения в настройки приложения «А-рама».
 *
 * Важно: после обновления приложения замените скрипт на эту версию.
 * Синхронизация передаёт только изменённые строки, а не весь справочник.
 */

var SYNC_TOKEN = 'смените-этот-секретный-токен'
var CATALOG_SHEET = 'Справочник'
var STOCK_SHEET = 'Остатки'
var FULL_REWRITE_THRESHOLD = 200

function doPost(e) {
  var lock = LockService.getScriptLock()
  try {
    lock.waitLock(30000)
  } catch (lockErr) {
    return json_({ ok: false, error: 'Таблица занята другой синхронизацией, повторите через минуту' })
  }

  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}')
    if (!body.token || body.token !== SYNC_TOKEN) {
      return json_({ ok: false, error: 'Неверный токен' })
    }

    ensureSheets_()
    var action = body.action || 'sync'

    if (action === 'pull') {
      var catalog = readCatalog_()
      var moldings = readMoldings_()
      return json_({
        ok: true,
        catalog: catalog,
        moldings: moldings,
        catalogCount: catalog.length,
        moldingsCount: moldings.length,
      })
    }

    if (action === 'push') {
      writeCatalog_(body.catalog || [], true)
      writeMoldings_(body.moldings || [], true)
      SpreadsheetApp.flush()
      return json_({
        ok: true,
        catalogCount: (body.catalog || []).length,
        moldingsCount: (body.moldings || []).length,
      })
    }

    var beforeCatalog = readCatalog_()
    var beforeMoldings = readMoldings_()

    var mergedCatalog = mergeByKey_(beforeCatalog, body.catalog || [], 'article')
    var mergedMoldings = mergeByKey_(beforeMoldings, body.moldings || [], 'id')
    mergedCatalog = removeKeys_(mergedCatalog, body.deletedCatalog || [], 'article')
    mergedMoldings = removeKeys_(mergedMoldings, body.deletedMoldings || [], 'id')

    deleteByKeys_(CATALOG_SHEET, body.deletedCatalog || [], 0, 5)
    deleteByKeys_(STOCK_SHEET, body.deletedMoldings || [], 0, 9)

    var catalogChanged = diffByKey_(beforeCatalog, mergedCatalog, 'article')
    var moldingChanged = diffByKey_(beforeMoldings, mergedMoldings, 'id')
    if (catalogChanged.length >= FULL_REWRITE_THRESHOLD) {
      writeCatalog_(mergedCatalog, true)
    } else {
      writeCatalog_(catalogChanged, false)
    }
    if (moldingChanged.length >= FULL_REWRITE_THRESHOLD) {
      writeMoldings_(mergedMoldings, true)
    } else {
      writeMoldings_(moldingChanged, false)
    }
    SpreadsheetApp.flush()

    var since = body.since || ''
    return json_({
      ok: true,
      catalog: filterSince_(mergedCatalog, since, body.catalog || [], 'article'),
      moldings: filterSince_(mergedMoldings, since, body.moldings || [], 'id'),
      catalogCount: mergedCatalog.length,
      moldingsCount: mergedMoldings.length,
    })
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) })
  } finally {
    try {
      lock.releaseLock()
    } catch (e) {}
  }
}

function doGet() {
  return json_({
    ok: true,
    app: 'А-рама',
    message: 'Веб-приложение синхронизации работает. Используйте POST из приложения.',
  })
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON,
  )
}

function ss_() {
  return SpreadsheetApp.getActiveSpreadsheet()
}

function ensureSheets_() {
  var book = ss_()
  if (!book.getSheetByName(CATALOG_SHEET)) {
    var c = book.insertSheet(CATALOG_SHEET)
    c.getRange(1, 1, 1, 5).setValues([
      ['Артикул', 'Название', 'Фото', 'Примечание', 'Обновлено'],
    ])
  }
  if (!book.getSheetByName(STOCK_SHEET)) {
    var s = book.insertSheet(STOCK_SHEET)
    s.getRange(1, 1, 1, 9).setValues([
      [
        'ID',
        'Ячейка',
        'Артикул',
        'Длина_см',
        'Количество',
        'Фото',
        'Комментарий',
        'Создано',
        'Обновлено',
      ],
    ])
  }
}

function readCatalog_() {
  var sheet = ss_().getSheetByName(CATALOG_SHEET)
  var values = sheet.getDataRange().getValues()
  var out = []
  for (var i = 1; i < values.length; i++) {
    var row = values[i]
    var article = String(row[0] || '').trim()
    if (!article) continue
    out.push({
      article: article,
      name: String(row[1] || '').trim(),
      photoUrl: String(row[2] || '').trim(),
      notes: String(row[3] || '').trim(),
      updatedAt: toIso_(row[4]),
    })
  }
  return out
}

function writeCatalog_(items, replaceAll) {
  var sheet = ss_().getSheetByName(CATALOG_SHEET)
  var rows = (items || []).map(function (item) {
    return [
      item.article || '',
      item.name || '',
      item.photoUrl || '',
      item.notes || '',
      item.updatedAt || new Date().toISOString(),
    ]
  })
  if (replaceAll) {
    sheet.clearContents()
    sheet.getRange(1, 1, 1, 5).setValues([
      ['Артикул', 'Название', 'Фото', 'Примечание', 'Обновлено'],
    ])
    if (!rows.length) return
    sheet.getRange(2, 1, rows.length, 5).setValues(rows)
    return
  }
  if (!rows.length) return
  upsertRows_(sheet, rows, 0, 5)
}

function readMoldings_() {
  var sheet = ss_().getSheetByName(STOCK_SHEET)
  var values = sheet.getDataRange().getValues()
  var out = []
  for (var i = 1; i < values.length; i++) {
    var row = values[i]
    var id = String(row[0] || '').trim()
    if (!id) continue
    out.push({
      id: id,
      cell: String(row[1] || '').trim(),
      article: String(row[2] || '').trim(),
      lengthCm: Number(row[3]) || 0,
      quantity: Math.max(0, Math.floor(Number(row[4]) || 0)),
      photoUrl: String(row[5] || '').trim(),
      comment: String(row[6] || '').trim(),
      createdAt: toIso_(row[7]),
      updatedAt: toIso_(row[8]),
    })
  }
  return out
}

function writeMoldings_(items, replaceAll) {
  var sheet = ss_().getSheetByName(STOCK_SHEET)
  var rows = (items || []).map(function (item) {
    return [
      item.id || '',
      item.cell || '',
      item.article || '',
      item.lengthCm || 0,
      item.quantity || 0,
      item.photoUrl || '',
      item.comment || '',
      item.createdAt || new Date().toISOString(),
      item.updatedAt || new Date().toISOString(),
    ]
  })
  if (replaceAll) {
    sheet.clearContents()
    sheet.getRange(1, 1, 1, 9).setValues([
      [
        'ID',
        'Ячейка',
        'Артикул',
        'Длина_см',
        'Количество',
        'Фото',
        'Комментарий',
        'Создано',
        'Обновлено',
      ],
    ])
    if (!rows.length) return
    sheet.getRange(2, 1, rows.length, 9).setValues(rows)
    return
  }
  if (!rows.length) return
  upsertRows_(sheet, rows, 0, 9)
}

function upsertRows_(sheet, rows, keyCol, width) {
  var lastRow = sheet.getLastRow()
  var existing =
    lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, width).getValues() : []
  var keyToRow = {}
  for (var i = 0; i < existing.length; i++) {
    var key = String(existing[i][keyCol] || '').trim()
    if (key) keyToRow[key] = i + 2
  }

  var appends = []
  for (var r = 0; r < rows.length; r++) {
    var row = rows[r]
    var k = String(row[keyCol] || '').trim()
    if (!k) continue
    var sheetRow = keyToRow[k]
    if (sheetRow) {
      sheet.getRange(sheetRow, 1, 1, width).setValues([row])
    } else {
      appends.push(row)
    }
  }
  if (appends.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, appends.length, width).setValues(appends)
  }
}

function deleteByKeys_(sheetName, keys, keyCol, width) {
  if (!keys || !keys.length) return
  var keySet = {}
  for (var i = 0; i < keys.length; i++) {
    var k = String(keys[i] || '').trim()
    if (k) keySet[k] = true
  }
  var sheet = ss_().getSheetByName(sheetName)
  var lastRow = sheet.getLastRow()
  if (lastRow < 2) return
  var values = sheet.getRange(2, 1, lastRow - 1, width).getValues()
  var toDelete = []
  for (var v = 0; v < values.length; v++) {
    if (keySet[String(values[v][keyCol] || '').trim()]) toDelete.push(v + 2)
  }
  for (var d = toDelete.length - 1; d >= 0; d--) {
    sheet.deleteRow(toDelete[d])
  }
}

function mergeByKey_(serverItems, clientItems, keyName) {
  var map = {}
  function put(item) {
    if (!item || !item[keyName]) return
    var key = String(item[keyName])
    var prev = map[key]
    if (!prev) {
      map[key] = item
      return
    }
    var a = Date.parse(prev.updatedAt || 0) || 0
    var b = Date.parse(item.updatedAt || 0) || 0
    map[key] = b >= a ? item : prev
  }
  ;(serverItems || []).forEach(put)
  ;(clientItems || []).forEach(put)
  return Object.keys(map).map(function (k) {
    return map[k]
  })
}

function removeKeys_(items, keys, keyName) {
  if (!keys || !keys.length) return items
  var drop = {}
  for (var i = 0; i < keys.length; i++) drop[String(keys[i])] = true
  return (items || []).filter(function (item) {
    return item && !drop[String(item[keyName])]
  })
}

function diffByKey_(before, after, keyName) {
  var prev = {}
  ;(before || []).forEach(function (item) {
    if (item && item[keyName]) prev[String(item[keyName])] = item.updatedAt || ''
  })
  return (after || []).filter(function (item) {
    if (!item || !item[keyName]) return false
    return prev[String(item[keyName])] !== (item.updatedAt || '')
  })
}

function filterSince_(items, since, alreadySent, keyName) {
  var sent = {}
  ;(alreadySent || []).forEach(function (item) {
    if (item && item[keyName]) sent[String(item[keyName])] = true
  })
  var t = Date.parse(since) || 0
  return (items || []).filter(function (item) {
    if (!item || !item[keyName] || sent[String(item[keyName])]) return false
    if (!since) return true
    return (Date.parse(item.updatedAt || 0) || 0) > t
  })
}

function toIso_(value) {
  if (!value) return new Date().toISOString()
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return value.toISOString()
  }
  var s = String(value).trim()
  if (!s) return new Date().toISOString()
  var d = new Date(s)
  if (!isNaN(d.getTime())) return d.toISOString()
  return s
}
