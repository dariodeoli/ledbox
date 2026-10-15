/** Geometría única para la vista previa y el archivo final de identidad. */
export type ImageFraming = { zoom: number; x: number; y: number };
export const DEFAULT_IMAGE_FRAMING: ImageFraming = { zoom: 1, x: 0, y: 0 };
const bounded = (value: number, min: number, max: number, fallback: number) => Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
export function imageFramingRect(sourceWidth: number, sourceHeight: number, width: number, height: number, framing: ImageFraming) {
  const scale = Math.min(width / sourceWidth, height / sourceHeight) * bounded(framing.zoom, 1, 8, 1);
  const drawWidth = sourceWidth * scale, drawHeight = sourceHeight * scale;
  const travelX = Math.abs(width - drawWidth) / 2, travelY = Math.abs(height - drawHeight) / 2;
  return { x: (width - drawWidth) / 2 + bounded(framing.x, -1, 1, 0) * travelX, y: (height - drawHeight) / 2 + bounded(framing.y, -1, 1, 0) * travelY, width: drawWidth, height: drawHeight, travelX, travelY };
}

/** Conserva las dimensiones máximas históricas de la preparación de identidad. */
export function identityImageSize(sourceWidth: number, sourceHeight: number, square: boolean, maxSide: number) {
  const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
  const side = square ? Math.min(sourceWidth, sourceHeight) : 0;
  const width = square ? Math.max(1, Math.round(side * scale)) : Math.max(1, Math.round(sourceWidth * scale));
  return { width, height: square ? width : Math.max(1, Math.round(sourceHeight * scale)) };
}

/** Avatar centrado inicial; los logos conservan toda su relación de aspecto. */
export function initialImageFraming(sourceWidth: number, sourceHeight: number, square: boolean): ImageFraming {
  return { zoom: square ? Math.min(8, Math.max(sourceWidth / sourceHeight, sourceHeight / sourceWidth)) : 1, x: 0, y: 0 };
}
export function boundedImageFraming(framing: ImageFraming): ImageFraming {
  return { zoom: bounded(framing.zoom, 1, 8, 1), x: bounded(framing.x, -1, 1, 0), y: bounded(framing.y, -1, 1, 0) };
}
