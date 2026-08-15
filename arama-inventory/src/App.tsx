import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  adjustQuantity,
  deleteCatalogItem,
  deleteMolding,
  exportAll,
  findCatalogByArticle,
  getCatalogItem,
  getMolding,
  getSyncSettings,
  importAll,
  listCatalog,
  listCells,
  listMoldings,
  saveCatalogItem,
  saveMolding,
  saveSyncSettings,
} from './db'
import { syncBidirectional, pullFromSheets, pushToSheets } from './sync'
import type { CatalogItem, Filters, MoldingItem, SyncSettings, View } from './types'
import {
  filterMoldings,
  formatDate,
  formatDateTime,
  formatLength,
  isLikelyImageUrl,
  summarizeStock,
} from './utils'

const emptyForm = {
  cell: '',
  article: '',
  lengthCm: '',
  quantity: '1',
  photoUrl: '',
  comment: '',
  createdAt: '',
}

const emptyCatalogForm = {
  article: '',
  name: '',
  photoUrl: '',
  notes: '',
}

type FormState = typeof emptyForm
type CatalogFormState = typeof emptyCatalogForm

function IconBack() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M15 6l-6 6 6 6"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconGear() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M19.4 13.5a7.8 7.8 0 0 0 .1-3l2-1.2-2-3.4-2.3.7a7.7 7.7 0 0 0-2.6-1.5L14 3h-4l-.6 2.1a7.7 7.7 0 0 0-2.6 1.5l-2.3-.7-2 3.4 2 1.2a7.8 7.8 0 0 0 .1 3l-2 1.2 2 3.4 2.3-.7a7.7 7.7 0 0 0 2.6 1.5L10 21h4l.6-2.1a7.7 7.7 0 0 0 2.6-1.5l2.3.7 2-3.4-2-1.2Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function Thumb({ url, article }: { url: string; article: string }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [url])
  if (!url || failed || !isLikelyImageUrl(url)) {
    return <div className="thumb">{article.slice(0, 4) || '—'}</div>
  }
  return (
    <div className="thumb">
      <img
        src={url}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    </div>
  )
}

function PhotoBlock({ url, className }: { url: string; className: string }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [url])
  if (!url) {
    return <div className={className}>Нет фото</div>
  }
  if (!isLikelyImageUrl(url) || failed) {
    return <div className={className}>Фото недоступно</div>
  }
  return (
    <div className={className}>
      <img
        src={url}
        alt="Фото багета"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    </div>
  )
}

export default function App() {
  const [view, setView] = useState<View>({ name: 'list' })
  const [items, setItems] = useState<MoldingItem[]>([])
  const [catalog, setCatalog] = useState<CatalogItem[]>([])
  const [cells, setCells] = useState<string[]>([])
  const [filters, setFilters] = useState<Filters>({ query: '', cell: '' })
  const [catalogQuery, setCatalogQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [catalogForm, setCatalogForm] = useState<CatalogFormState>(emptyCatalogForm)
  const [formError, setFormError] = useState('')
  const [catalogHint, setCatalogHint] = useState('')
  const [detail, setDetail] = useState<MoldingItem | null>(null)
  const [syncSettings, setSyncSettings] = useState<SyncSettings>({
    scriptUrl: '',
    token: '',
    lastSyncAt: '',
    autoSync: false,
  })
  const [syncBusy, setSyncBusy] = useState(false)
  const [syncMessage, setSyncMessage] = useState('')
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [showInstall, setShowInstall] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const photoManualRef = useRef(false)

  async function refresh() {
    const [all, cellList, catalogList, settings] = await Promise.all([
      listMoldings(),
      listCells(),
      listCatalog(),
      getSyncSettings(),
    ])
    setItems(all)
    setCells(cellList)
    setCatalog(catalogList)
    setSyncSettings(settings)
  }

  useEffect(() => {
    refresh().finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      ('standalone' in navigator &&
        Boolean((navigator as Navigator & { standalone?: boolean }).standalone))
    if (standalone) return

    const onPrompt = (e: Event) => {
      e.preventDefault()
      setInstallPrompt(e as BeforeInstallPromptEvent)
      setShowInstall(true)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])

  useEffect(() => {
    if (view.name === 'form') {
      photoManualRef.current = false
      if (view.itemId) {
        getMolding(view.itemId).then((item) => {
          if (!item) {
            setView({ name: 'list' })
            return
          }
          setForm({
            cell: item.cell,
            article: item.article,
            lengthCm: String(item.lengthCm),
            quantity: String(item.quantity),
            photoUrl: item.photoUrl,
            comment: item.comment,
            createdAt: item.createdAt.slice(0, 10),
          })
          setFormError('')
          setCatalogHint('')
        })
      } else {
        setForm({
          ...emptyForm,
          createdAt: new Date().toISOString().slice(0, 10),
        })
        setFormError('')
        setCatalogHint('')
      }
    }
    if (view.name === 'detail') {
      getMolding(view.itemId).then((item) => {
        if (!item) {
          setView({ name: 'list' })
          return
        }
        setDetail(item)
      })
    }
    if (view.name === 'catalog-form') {
      if (view.article) {
        getCatalogItem(view.article).then((item) => {
          if (!item) {
            setView({ name: 'catalog' })
            return
          }
          setCatalogForm({
            article: item.article,
            name: item.name,
            photoUrl: item.photoUrl,
            notes: item.notes,
          })
          setFormError('')
        })
      } else {
        setCatalogForm(emptyCatalogForm)
        setFormError('')
      }
    }
    if (view.name === 'sync') {
      getSyncSettings().then(setSyncSettings)
      setSyncMessage('')
    }
  }, [view])

  // Автоподстановка фото из справочника при вводе артикула
  useEffect(() => {
    if (view.name !== 'form') return
    const article = form.article.trim()
    if (!article) {
      setCatalogHint('')
      return
    }

    let cancelled = false
    const timer = window.setTimeout(() => {
      void findCatalogByArticle(article).then((item) => {
        if (cancelled) return
        if (!item) {
          setCatalogHint('Артикула нет в справочнике')
          return
        }
        setCatalogHint(
          item.name
            ? `Из справочника: ${item.name}`
            : 'Артикул найден в справочнике — фото подставлено',
        )
        if (!photoManualRef.current && item.photoUrl) {
          setForm((f) => (f.photoUrl === item.photoUrl ? f : { ...f, photoUrl: item.photoUrl }))
        }
      })
    }, 280)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [form.article, view])

  const visible = filterMoldings(items, filters)
  const stats = summarizeStock(filters.cell || filters.query ? visible : items)
  const visibleCatalog = catalog.filter((c) => {
    const q = catalogQuery.trim().toLowerCase()
    if (!q) return true
    return [c.article, c.name, c.notes, c.photoUrl].join(' ').toLowerCase().includes(q)
  })

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!form.cell.trim()) {
      setFormError('Укажите номер ячейки')
      return
    }
    if (!form.article.trim()) {
      setFormError('Укажите артикул')
      return
    }
    const lengthCm = Number(form.lengthCm.replace(',', '.'))
    if (!lengthCm || lengthCm <= 0) {
      setFormError('Укажите длину рейки в сантиметрах')
      return
    }
    const quantity = Math.max(0, Math.floor(Number(form.quantity) || 0))
    const createdAt = form.createdAt
      ? new Date(`${form.createdAt}T12:00:00`).toISOString()
      : undefined

    const saved = await saveMolding({
      id: view.name === 'form' ? view.itemId : undefined,
      cell: form.cell,
      article: form.article,
      lengthCm,
      quantity,
      photoUrl: form.photoUrl,
      comment: form.comment,
      createdAt,
    })

    // Если артикула нет в справочнике, а фото есть — добавим в справочник
    const existing = await findCatalogByArticle(saved.article)
    if (!existing && saved.photoUrl) {
      await saveCatalogItem({
        article: saved.article,
        name: '',
        photoUrl: saved.photoUrl,
        notes: saved.comment,
      })
    } else if (existing && saved.photoUrl && !existing.photoUrl) {
      await saveCatalogItem({
        ...existing,
        photoUrl: saved.photoUrl,
      })
    }

    await refresh()
    if (syncSettings.autoSync && syncSettings.scriptUrl) {
      try {
        await syncBidirectional()
        await refresh()
      } catch {
        // остатки уже сохранены локально
      }
    }
    setView({ name: 'detail', itemId: saved.id })
  }

  async function onCatalogSubmit(e: FormEvent) {
    e.preventDefault()
    if (!catalogForm.article.trim()) {
      setFormError('Укажите артикул')
      return
    }
    if (!catalogForm.photoUrl.trim()) {
      setFormError('Укажите ссылку на фото')
      return
    }
    await saveCatalogItem(catalogForm)
    await refresh()
    setView({ name: 'catalog' })
  }

  async function onDelete(id: string) {
    if (!confirm('Удалить эту запись со склада?')) return
    await deleteMolding(id)
    await refresh()
    setView({ name: 'list' })
  }

  async function onDeleteCatalog(article: string) {
    if (!confirm(`Удалить артикул ${article} из справочника?`)) return
    await deleteCatalogItem(article)
    await refresh()
  }

  async function onAdjust(id: string, delta: number) {
    const updated = await adjustQuantity(id, delta)
    if (updated) {
      setDetail(updated)
      await refresh()
      if (syncSettings.autoSync && syncSettings.scriptUrl) {
        try {
          await syncBidirectional()
          await refresh()
        } catch {
          /* ignore */
        }
      }
    }
  }

  async function onExport() {
    const data = await exportAll()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `arama-sklad-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function onImportFile(file: File) {
    try {
      const text = await file.text()
      const parsed = JSON.parse(text) as MoldingItem[]
      if (!Array.isArray(parsed)) throw new Error('Неверный формат')
      if (!confirm(`Импортировать записей: ${parsed.length}?`)) return
      const mode = confirm(
        'Заменить весь склад этими данными?\nОК — заменить всё.\nОтмена — добавить к текущим.',
      )
        ? 'replace'
        : 'merge'
      await importAll(parsed, mode)
      await refresh()
      alert(`Импортировано записей: ${parsed.length}`)
      setView({ name: 'list' })
    } catch {
      alert('Не удалось импортировать файл. Нужен JSON-экспорт из А-рама.')
    }
  }

  async function saveSyncForm() {
    await saveSyncSettings(syncSettings)
    setSyncMessage('Настройки сохранены')
  }

  async function runSync(kind: 'sync' | 'pull' | 'push') {
    setSyncBusy(true)
    setSyncMessage('')
    try {
      await saveSyncSettings(syncSettings)
      const result =
        kind === 'pull'
          ? await pullFromSheets()
          : kind === 'push'
            ? await pushToSheets()
            : await syncBidirectional()
      await refresh()
      setSyncMessage(
        `Готово: справочник ${result.catalogCount}, остатки ${result.moldingsCount}`,
      )
    } catch (err) {
      setSyncMessage(err instanceof Error ? err.message : 'Ошибка синхронизации')
    } finally {
      setSyncBusy(false)
    }
  }

  async function installApp() {
    if (!installPrompt) return
    await installPrompt.prompt()
    setInstallPrompt(null)
    setShowInstall(false)
  }

  return (
    <div className="app-shell">
      {view.name === 'list' && (
        <>
          <header className="brand-bar">
            <div className="brand-mark">
              <h1 className="brand-name">А-рама</h1>
              <p className="brand-sub">Склад багетных реек</p>
            </div>
            <button
              className="icon-btn"
              type="button"
              aria-label="Настройки"
              onClick={() => setView({ name: 'backup' })}
            >
              <IconGear />
            </button>
          </header>

          <nav className="tab-bar" aria-label="Разделы">
            <button type="button" className="tab active">
              Склад
            </button>
            <button type="button" className="tab" onClick={() => setView({ name: 'catalog' })}>
              Справочник
            </button>
            <button type="button" className="tab" onClick={() => setView({ name: 'sync' })}>
              Таблицы
            </button>
          </nav>

          {showInstall && installPrompt && (
            <div className="install-banner">
              <p>Установите «А-рама» на телефон — приложение откроется как обычная программа Android.</p>
              <button className="btn" type="button" onClick={installApp}>
                Установить
              </button>
            </div>
          )}

          <div className="stats-row">
            <div className="stat">
              <strong>{stats.skuCount}</strong>
              <span>позиций</span>
            </div>
            <div className="stat">
              <strong>{stats.totalPieces}</strong>
              <span>реек</span>
            </div>
            <div className="stat">
              <strong>{catalog.length}</strong>
              <span>в справ.</span>
            </div>
          </div>

          <div className="toolbar">
            <input
              className="search-field"
              type="search"
              placeholder="Поиск: артикул, ячейка, комментарий…"
              value={filters.query}
              onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
            />
            <div className="cell-chips" role="listbox" aria-label="Фильтр по ячейке">
              <button
                type="button"
                className={`chip ${filters.cell === '' ? 'active' : ''}`}
                onClick={() => setFilters((f) => ({ ...f, cell: '' }))}
              >
                Все ячейки
              </button>
              {cells.map((cell) => (
                <button
                  key={cell}
                  type="button"
                  className={`chip ${filters.cell === cell ? 'active' : ''}`}
                  onClick={() =>
                    setFilters((f) => ({ ...f, cell: f.cell === cell ? '' : cell }))
                  }
                >
                  {cell}
                </button>
              ))}
            </div>
          </div>

          <section className="list" aria-live="polite">
            {loading && <div className="empty">Загрузка склада…</div>}
            {!loading && visible.length === 0 && (
              <div className="empty">
                <strong>Склад пока пуст</strong>
                Добавьте первую рейку — укажите ячейку, артикул и длину.
              </div>
            )}
            {visible.map((item) => (
              <button
                key={item.id}
                type="button"
                className="item-row"
                onClick={() => setView({ name: 'detail', itemId: item.id })}
              >
                <Thumb url={item.photoUrl} article={item.article} />
                <div className="item-main">
                  <h3>{item.article}</h3>
                  <p className="item-meta">
                    Ячейка {item.cell} · {formatLength(item.lengthCm)}
                    <br />
                    {formatDate(item.createdAt)}
                    {item.comment
                      ? ` · ${item.comment.slice(0, 42)}${item.comment.length > 42 ? '…' : ''}`
                      : ''}
                  </p>
                </div>
                <div className="qty-badge">
                  {item.quantity}
                  <small>шт</small>
                </div>
              </button>
            ))}
          </section>

          <button className="fab" type="button" onClick={() => setView({ name: 'form' })}>
            + Добавить рейку
          </button>
        </>
      )}

      {view.name === 'form' && (
        <>
          <div className="screen-header">
            <button
              className="icon-btn"
              type="button"
              aria-label="Назад"
              onClick={() =>
                setView(
                  view.itemId ? { name: 'detail', itemId: view.itemId } : { name: 'list' },
                )
              }
            >
              <IconBack />
            </button>
            <h2>{view.itemId ? 'Редактирование' : 'Новая рейка'}</h2>
          </div>

          <form className="form" onSubmit={onSubmit}>
            <div className="field-row">
              <div className="field">
                <label htmlFor="cell">Ячейка</label>
                <input
                  id="cell"
                  inputMode="text"
                  placeholder="Напр. A-12"
                  value={form.cell}
                  onChange={(e) => setForm((f) => ({ ...f, cell: e.target.value }))}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="quantity">Количество</label>
                <input
                  id="quantity"
                  inputMode="numeric"
                  value={form.quantity}
                  onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
                />
              </div>
            </div>

            <div className="field">
              <label htmlFor="article">Артикул</label>
              <input
                id="article"
                list="catalog-articles"
                placeholder="Код багета"
                value={form.article}
                onChange={(e) => {
                  photoManualRef.current = false
                  setForm((f) => ({ ...f, article: e.target.value }))
                }}
                required
              />
              <datalist id="catalog-articles">
                {catalog.map((c) => (
                  <option key={c.article} value={c.article}>
                    {c.name || c.article}
                  </option>
                ))}
              </datalist>
              {catalogHint && <p className="field-hint">{catalogHint}</p>}
            </div>

            <div className="field-row">
              <div className="field">
                <label htmlFor="length">Длина, см</label>
                <input
                  id="length"
                  type="number"
                  inputMode="decimal"
                  min="1"
                  step="any"
                  placeholder="300"
                  value={form.lengthCm}
                  onChange={(e) => setForm((f) => ({ ...f, lengthCm: e.target.value }))}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="createdAt">Дата внесения</label>
                <input
                  id="createdAt"
                  type="date"
                  value={form.createdAt}
                  onChange={(e) => setForm((f) => ({ ...f, createdAt: e.target.value }))}
                />
              </div>
            </div>

            <div className="field">
              <label htmlFor="photoUrl">Фото по ссылке</label>
              <input
                id="photoUrl"
                type="url"
                placeholder="Подставится из справочника или введите вручную"
                value={form.photoUrl}
                onChange={(e) => {
                  photoManualRef.current = true
                  setForm((f) => ({ ...f, photoUrl: e.target.value }))
                }}
              />
            </div>

            {form.photoUrl && <PhotoBlock url={form.photoUrl} className="photo-preview" />}

            <div className="field">
              <label htmlFor="comment">Комментарий</label>
              <textarea
                id="comment"
                placeholder="Цвет, профиль, примечание…"
                value={form.comment}
                onChange={(e) => setForm((f) => ({ ...f, comment: e.target.value }))}
              />
            </div>

            {formError && <p className="error">{formError}</p>}

            <div className="actions">
              <button className="btn btn-primary" type="submit">
                Сохранить
              </button>
            </div>
          </form>
        </>
      )}

      {view.name === 'detail' && detail && (
        <div className="detail">
          <div className="screen-header">
            <button
              className="icon-btn"
              type="button"
              aria-label="Назад"
              onClick={() => setView({ name: 'list' })}
            >
              <IconBack />
            </button>
            <h2>Карточка рейки</h2>
          </div>

          <PhotoBlock url={detail.photoUrl} className="detail-hero" />

          <h1>{detail.article}</h1>
          <p className="detail-line">Ячейка {detail.cell}</p>
          <p className="detail-line">{formatLength(detail.lengthCm)}</p>

          <div className="qty-controls" aria-label="Остаток">
            <button type="button" onClick={() => onAdjust(detail.id, -1)} aria-label="Минус">
              −
            </button>
            <div className="qty-value">{detail.quantity} шт</div>
            <button type="button" onClick={() => onAdjust(detail.id, 1)} aria-label="Плюс">
              +
            </button>
          </div>

          <div className="kv">
            <div className="kv-row">
              <span>Дата внесения</span>
              <strong>{formatDate(detail.createdAt)}</strong>
            </div>
            <div className="kv-row">
              <span>Обновлено</span>
              <strong>{formatDateTime(detail.updatedAt)}</strong>
            </div>
            {detail.photoUrl && (
              <div className="kv-row">
                <span>Ссылка на фото</span>
                <strong>
                  <a href={detail.photoUrl} target="_blank" rel="noreferrer">
                    Открыть
                  </a>
                </strong>
              </div>
            )}
          </div>

          {detail.comment && <p className="comment-box">{detail.comment}</p>}

          <div className="actions">
            <button
              className="btn btn-primary"
              type="button"
              onClick={() => setView({ name: 'form', itemId: detail.id })}
            >
              Редактировать
            </button>
            <button className="btn btn-danger" type="button" onClick={() => onDelete(detail.id)}>
              Удалить
            </button>
          </div>
        </div>
      )}

      {view.name === 'catalog' && (
        <>
          <div className="screen-header">
            <button
              className="icon-btn"
              type="button"
              aria-label="Назад"
              onClick={() => setView({ name: 'list' })}
            >
              <IconBack />
            </button>
            <h2>Справочник багета</h2>
          </div>

          <nav className="tab-bar" aria-label="Разделы">
            <button type="button" className="tab" onClick={() => setView({ name: 'list' })}>
              Склад
            </button>
            <button type="button" className="tab active">
              Справочник
            </button>
            <button type="button" className="tab" onClick={() => setView({ name: 'sync' })}>
              Таблицы
            </button>
          </nav>

          <div className="toolbar">
            <input
              className="search-field"
              type="search"
              placeholder="Поиск по артикулу или названию…"
              value={catalogQuery}
              onChange={(e) => setCatalogQuery(e.target.value)}
            />
          </div>

          <section className="list" style={{ paddingBottom: 88 }}>
            {visibleCatalog.length === 0 && (
              <div className="empty">
                <strong>Справочник пуст</strong>
                Добавьте артикулы с ссылками на фото — или загрузите из Google Таблицы.
              </div>
            )}
            {visibleCatalog.map((item) => (
              <div key={item.article} className="item-row catalog-row">
                <button
                  type="button"
                  className="catalog-main"
                  onClick={() => setView({ name: 'catalog-form', article: item.article })}
                >
                  <Thumb url={item.photoUrl} article={item.article} />
                  <div className="item-main">
                    <h3>{item.article}</h3>
                    <p className="item-meta">
                      {item.name || 'Без названия'}
                      {item.notes ? ` · ${item.notes.slice(0, 40)}` : ''}
                    </p>
                  </div>
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Удалить"
                  onClick={() => onDeleteCatalog(item.article)}
                >
                  ×
                </button>
              </div>
            ))}
          </section>

          <button
            className="fab"
            type="button"
            onClick={() => setView({ name: 'catalog-form' })}
          >
            + Артикул
          </button>
        </>
      )}

      {view.name === 'catalog-form' && (
        <>
          <div className="screen-header">
            <button
              className="icon-btn"
              type="button"
              aria-label="Назад"
              onClick={() => setView({ name: 'catalog' })}
            >
              <IconBack />
            </button>
            <h2>{view.article ? 'Карточка багета' : 'Новый артикул'}</h2>
          </div>

          <form className="form" onSubmit={onCatalogSubmit}>
            <div className="field">
              <label htmlFor="cat-article">Артикул</label>
              <input
                id="cat-article"
                value={catalogForm.article}
                onChange={(e) => setCatalogForm((f) => ({ ...f, article: e.target.value }))}
                disabled={Boolean(view.article)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="cat-name">Название</label>
              <input
                id="cat-name"
                placeholder="Напр. Золотой классика 30 мм"
                value={catalogForm.name}
                onChange={(e) => setCatalogForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="field">
              <label htmlFor="cat-photo">Ссылка на фото</label>
              <input
                id="cat-photo"
                type="url"
                placeholder="https://…"
                value={catalogForm.photoUrl}
                onChange={(e) => setCatalogForm((f) => ({ ...f, photoUrl: e.target.value }))}
                required
              />
            </div>
            {catalogForm.photoUrl && (
              <PhotoBlock url={catalogForm.photoUrl} className="photo-preview" />
            )}
            <div className="field">
              <label htmlFor="cat-notes">Примечание</label>
              <textarea
                id="cat-notes"
                value={catalogForm.notes}
                onChange={(e) => setCatalogForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
            {formError && <p className="error">{formError}</p>}
            <div className="actions">
              <button className="btn btn-primary" type="submit">
                Сохранить в справочник
              </button>
            </div>
          </form>
        </>
      )}

      {view.name === 'sync' && (
        <>
          <div className="screen-header">
            <button
              className="icon-btn"
              type="button"
              aria-label="Назад"
              onClick={() => setView({ name: 'list' })}
            >
              <IconBack />
            </button>
            <h2>Google Таблицы</h2>
          </div>

          <nav className="tab-bar" aria-label="Разделы">
            <button type="button" className="tab" onClick={() => setView({ name: 'list' })}>
              Склад
            </button>
            <button type="button" className="tab" onClick={() => setView({ name: 'catalog' })}>
              Справочник
            </button>
            <button type="button" className="tab active">
              Таблицы
            </button>
          </nav>

          <div className="form">
            <p className="hint">
              Синхронизация справочника и остатков с Google Таблицей через Apps Script. Инструкция —
              в файле <code>google-apps-script/README.md</code> в проекте.
            </p>

            <div className="field">
              <label htmlFor="scriptUrl">URL веб-приложения</label>
              <input
                id="scriptUrl"
                type="url"
                placeholder="https://script.google.com/macros/s/…/exec"
                value={syncSettings.scriptUrl}
                onChange={(e) =>
                  setSyncSettings((s) => ({ ...s, scriptUrl: e.target.value }))
                }
              />
            </div>

            <div className="field">
              <label htmlFor="token">Секретный токен</label>
              <input
                id="token"
                type="password"
                placeholder="Тот же, что в Code.gs"
                value={syncSettings.token}
                onChange={(e) => setSyncSettings((s) => ({ ...s, token: e.target.value }))}
                autoComplete="off"
              />
            </div>

            <label className="check-row">
              <input
                type="checkbox"
                checked={syncSettings.autoSync}
                onChange={(e) =>
                  setSyncSettings((s) => ({ ...s, autoSync: e.target.checked }))
                }
              />
              Автосинхронизация после изменений на складе
            </label>

            {syncSettings.lastSyncAt && (
              <p className="hint">Последняя синхронизация: {formatDateTime(syncSettings.lastSyncAt)}</p>
            )}

            {syncMessage && <p className={syncMessage.startsWith('Готово') ? 'field-hint' : 'error'}>{syncMessage}</p>}

            <div className="actions">
              <button
                className="btn btn-primary"
                type="button"
                disabled={syncBusy}
                onClick={() => void runSync('sync')}
              >
                {syncBusy ? 'Синхронизация…' : 'Синхронизировать'}
              </button>
              <button
                className="btn btn-secondary"
                type="button"
                disabled={syncBusy}
                onClick={() => void saveSyncForm()}
              >
                Сохранить настройки
              </button>
              <button
                className="btn btn-secondary"
                type="button"
                disabled={syncBusy}
                onClick={() => void runSync('pull')}
              >
                Только загрузить из таблицы
              </button>
              <button
                className="btn btn-secondary"
                type="button"
                disabled={syncBusy}
                onClick={() => void runSync('push')}
              >
                Только выгрузить в таблицу
              </button>
            </div>
          </div>
        </>
      )}

      {view.name === 'backup' && (
        <>
          <div className="screen-header">
            <button
              className="icon-btn"
              type="button"
              aria-label="Назад"
              onClick={() => setView({ name: 'list' })}
            >
              <IconBack />
            </button>
            <h2>Данные и установка</h2>
          </div>

          <div className="form">
            <p className="hint">
              Остатки и справочник хранятся на телефоне. Для обмена с компьютером используйте Google
              Таблицы или JSON-копию.
            </p>
            <div className="actions">
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => setView({ name: 'sync' })}
              >
                Настроить Google Таблицы
              </button>
              <button className="btn btn-secondary" type="button" onClick={onExport}>
                Экспорт склада (JSON)
              </button>
              <button
                className="btn btn-secondary"
                type="button"
                onClick={() => fileRef.current?.click()}
              >
                Импорт JSON
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void onImportFile(file)
                  e.target.value = ''
                }}
              />
            </div>

            <p className="hint">
              APK: файл <code>releases/Arama-sklad-debug.apk</code>. Либо Chrome → «Установить
              приложение».
            </p>

            {installPrompt && (
              <button className="btn btn-primary" type="button" onClick={installApp}>
                Установить сейчас
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}
