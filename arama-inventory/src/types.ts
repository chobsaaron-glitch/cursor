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

export type View =
  | { name: 'list' }
  | { name: 'form'; itemId?: string }
  | { name: 'detail'; itemId: string }
  | { name: 'backup' }

export type Filters = {
  query: string
  cell: string
}
