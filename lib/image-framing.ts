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
