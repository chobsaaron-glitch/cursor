export type MoldingItem = {
  id: string
  cell: string
  article: string
  lengthCm: number
  quantity: number
  photoUrl: string
  comment: string
  createdAt: string
  updatedAt: string
}

export type MoldingInput = Omit<MoldingItem, 'id' | 'createdAt' | 'updatedAt'> & {
  id?: string
  createdAt?: string
}

/** Справочник багета: артикул → фото и описание */
export type CatalogItem = {
  article: string
  name: string
  photoUrl: string
  notes: string
  updatedAt: string
}

export type CatalogInput = Omit<CatalogItem, 'updatedAt'> & {
  updatedAt?: string
}

export type SyncSettings = {
  scriptUrl: string
  token: string
  lastSyncAt: string
  autoSync: boolean
}

export type View =
  | { name: 'list' }
  | { name: 'form'; itemId?: string }
  | { name: 'detail'; itemId: string }
  | { name: 'backup' }
  | { name: 'catalog' }
  | { name: 'catalog-form'; article?: string }
  | { name: 'sync' }

export type Filters = {
  query: string
  cell: string
}

export type SyncPayload = {
  catalog: CatalogItem[]
  moldings: MoldingItem[]
}
