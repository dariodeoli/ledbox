import QRCode from "qrcode";

/**
 * QR del portal del cliente (issue #12). Un solo helper: el contenido siempre
 * es la URL pública del presupuesto (`cliente.ledbox.online/p/<código>`), nunca
 * el id interno ni datos de otra empresa.
 *
 * - `qrSvg`: SVG en texto para la hoja imprimible (nítido en PDF y a cualquier
 *   tamaño, sin request extra).
 * - `qrDataUrl`: PNG en data URL para el diálogo del panel.
 *
 * Corrección de errores media y margen mínimo: el código se lee bien impreso en
 * papel y también desde la pantalla del celular.
 */

const QR_OPTIONS = { errorCorrectionLevel: "M", margin: 1 } as const;

export async function qrSvg(text: string, size = 200): Promise<string> {
  return QRCode.toString(text, { ...QR_OPTIONS, type: "svg", width: size });
}

export async function qrDataUrl(text: string, size = 220): Promise<string> {
  return QRCode.toDataURL(text, { ...QR_OPTIONS, type: "image/png", width: size });
}
