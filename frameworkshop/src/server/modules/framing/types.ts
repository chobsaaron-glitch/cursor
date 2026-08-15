/**
 * FramingSpec — the declarative description of a framed piece.
 *
 * It contains only what the receptionist actually chooses (sizes, materials,
 * options). Everything derived — opening sizes, chop lengths, sheet areas,
 * waste — is produced by the calculation engine and never stored by hand.
 */

export type MatShape = 'RECT' | 'OVAL' | 'CIRCLE' | 'ARCH' | 'BEVELLED_CORNERS' | 'CUSTOM';

export type GlazingPosition = 'INNER' | 'BETWEEN' | 'OUTER';

export type MountingMethod =
  | 'NONE'
  | 'HINGE'
  | 'DRY_MOUNT'
  | 'FOAM_MOUNT'
  | 'STRETCH_MANUAL'
  | 'STRETCH_FOAM'
  | 'STRETCH_SUBFRAME'
  | 'STRETCH_GALLERY'
  | 'FLOAT_MOUNT';

export interface Margins {
  leftMm: number;
  rightMm: number;
  topMm: number;
  bottomMm: number;
}

export interface MatLayerSpec {
  /** 1 = top layer facing the viewer. Up to 7 layers are supported. */
  layer: number;
  catalogItemId?: string | null;
  name?: string;
  /**
   * Visible border of the top layer. Lower layers ignore margins and use
   * `revealMm` instead — that is exactly how a double mat behaves.
   */
  margins?: Margins;
  /** Visible strip of this layer under the layer above it. */
  revealMm?: number;
  /** How much of the artwork this window overlaps on each side. */
  overlapMm?: number;
  openings?: number;
  shape?: MatShape;
  vGroove?: boolean;
  reverseBevel?: boolean;
  decorativeLine?: boolean;
}

export interface MouldingLayerSpec {
  /** INNER sits next to the art, OUTER wraps everything. */
  role: 'INNER' | 'OUTER';
  catalogItemId: string;
  name?: string;
  /** Overrides for items whose spec is missing or has to be tweaked once. */
  widthMm?: number;
  rabbetOverlapMm?: number;
  /** Clearance between the sandwich and the rabbet, total for both sides. */
  clearanceMm?: number;
}

export interface GlazingSpec {
  catalogItemId: string;
  name?: string;
  position?: GlazingPosition;
  /** Spacer between glazing and artwork — affects depth, not the cut size. */
  spacerMm?: number;
}

export interface BackingSpec {
  catalogItemId: string;
  name?: string;
}

export interface MountingSpec {
  method: MountingMethod;
  catalogItemId?: string | null;
  /** Board the artwork is mounted onto (foamboard, MDF…). */
  boardCatalogItemId?: string | null;
  name?: string;
}

export interface SubframeSpec {
  catalogItemId: string;
  name?: string;
  /** Extra material wrapped around the subframe edges. */
  wrapMm?: number;
}

export interface HardwareSpec {
  catalogItemId: string;
  name?: string;
  /** Explicit quantity; when omitted the catalog defaults are applied. */
  quantity?: number;
}

export interface ExtraSpec {
  catalogItemId: string;
  name?: string;
  quantity?: number;
  note?: string;
}

export interface ServiceSpecRef {
  catalogItemId: string;
  name?: string;
  quantity?: number;
}

export interface FramingSpec {
  artworkWidthMm: number;
  artworkHeightMm: number;
  quantity?: number;
  mats?: MatLayerSpec[];
  mouldings?: MouldingLayerSpec[];
  glazing?: GlazingSpec | null;
  glazingPosition?: GlazingPosition;
  backing?: BackingSpec | null;
  mounting?: MountingSpec | null;
  subframe?: SubframeSpec | null;
  hardware?: HardwareSpec[];
  extras?: ExtraSpec[];
  services?: ServiceSpecRef[];
  /** Total clearance (both sides) between sandwich and frame rabbet. */
  clearanceMm?: number;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Calculation result
// ---------------------------------------------------------------------------

export interface Size {
  widthMm: number;
  heightMm: number;
}

export interface MatLayerResult {
  layer: number;
  catalogItemId?: string | null;
  name?: string;
  /** Outer size — identical for every layer of the sandwich. */
  outer: Size;
  /** Window cut into this layer. */
  opening: Size;
  visibleBorder: Margins;
  areaM2: number;
  /** Length of the bevel cut, used for per-metre matboard cutting tariffs. */
  cutLengthMm: number;
  openings: number;
  vGrooveLengthMm: number;
}

export interface FrameResult {
  role: 'INNER' | 'OUTER';
  catalogItemId: string;
  name?: string;
  widthMm: number;
  /** Rabbet opening the sandwich drops into. */
  opening: Size;
  /** Outside dimensions of the assembled frame. */
  outer: Size;
  /** Four mitred pieces, long-point length in millimetres. */
  pieces: number[];
  totalLengthMm: number;
  /** Length actually taken from stock, waste and kerf included. */
  consumedLengthMm: number;
  wasteLengthMm: number;
  cuts: number;
  joins: number;
}

export interface SheetResult {
  catalogItemId: string;
  name?: string;
  size: Size;
  areaM2: number;
  /** Fraction of a standard sheet consumed, including waste. */
  sheets: number;
  perimeterMm: number;
}

export interface CalculationResult {
  artwork: Size;
  /** Visible area of the artwork after mat overlap. */
  sight: Size;
  /** Mat / glazing / backing cut size. */
  sandwich: Size;
  /** Outermost frame dimensions — what the customer sees on the wall. */
  outer: Size;
  mats: MatLayerResult[];
  frames: FrameResult[];
  glazing?: SheetResult & { position: GlazingPosition };
  backing?: SheetResult;
  mountingBoard?: SheetResult;
  subframe?: {
    catalogItemId: string;
    name?: string;
    size: Size;
    totalLengthMm: number;
    consumedLengthMm: number;
  };
  totals: {
    perimeterMm: number;
    areaM2: number;
    unitedInches: number;
    depthMm: number;
  };
  warnings: string[];
}
