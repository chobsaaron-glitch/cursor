/**
 * А-рама — синхронизация с Google Таблицами
 *
 * 1. Создайте Google Таблицу (или откройте существующую).
 * 2. Расширения → Apps Script → вставьте этот код.
 * 3. В SYNC_TOKEN укажите свой секретный пароль.
 * 4. Развернуть → Новое развёртывание → Тип: веб-приложение
 *    - Выполнять от имени: меня
 *    - Доступ: все пользователи
 * 5. Скопируйте URL веб-приложения в настройки приложения «А-рама».
 */

var SYNC_TOKEN = 'смените-этот-секретный-токен'
var CATALOG_SHEET = 'Справочник'
var STOCK_SHEET = 'Остатки'

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}')
    if (!body.token || body.token !== SYNC_TOKEN) {
      return json_({ ok: false, error: 'Неверный токен' })
    }

    ensureSheets_()
    var action = body.action || 'sync'

    if (action === 'pull') {
      return json_({
        ok: true,
        catalog: readCatalog_(),
        moldings: readMoldings_(),
      })
    }

    if (action === 'push') {
      writeCatalog_(body.catalog || [])
      writeMoldings_(body.moldings || [])
      return json_({
        ok: true,
        catalog: readCatalog_(),
        moldings: readMoldings_(),
      })
    }

    // sync: merge by updatedAt, then return full state
    var mergedCatalog = mergeByKey_(
      readCatalog_(),
      body.catalog || [],
      'article',
    )
    var mergedMoldings = mergeByKey_(
      readMoldings_(),
      body.moldings || [],
      'id',
    )
    writeCatalog_(mergedCatalog)
    writeMoldings_(mergedMoldings)

    return json_({
      ok: true,
      catalog: mergedCatalog,
      moldings: mergedMoldings,
    })
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) })
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

function writeCatalog_(items) {
  var sheet = ss_().getSheetByName(CATALOG_SHEET)
  sheet.clearContents()
  sheet.getRange(1, 1, 1, 5).setValues([
    ['Артикул', 'Название', 'Фото', 'Примечание', 'Обновлено'],
  ])
  if (!items || !items.length) return
  var rows = items.map(function (item) {
    return [
      item.article || '',
      item.name || '',
      item.photoUrl || '',
      item.notes || '',
      item.updatedAt || new Date().toISOString(),
    ]
  })
  // getRange(row, column, numRows, numColumns) — 3-й параметр это ЧИСЛО строк
  sheet.getRange(2, 1, rows.length, 5).setValues(rows)
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

function writeMoldings_(items) {
  var sheet = ss_().getSheetByName(STOCK_SHEET)
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
  if (!items || !items.length) return
  var rows = items.map(function (item) {
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
  sheet.getRange(2, 1, rows.length + 1, 9).setValues(rows)
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
