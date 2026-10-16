import { Inflate } from "fflate";
import { assertSafeEntryName } from "./import-photos";

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
const invalid = (message = "El ZIP está dañado o utiliza un formato no compatible."): never => { throw new Error(message); };

/** Strict v1 ZIP reader. Header sizes are checked, NEVER trusted as output allocation.
 * Inflate gets small compressed chunks; every actual output chunk counts against
 * both declared length and our global cap before retaining it. CRC32 is independent.
 * ZIP64, descriptors/encryption/multidisk and non-contiguous local entries are
 * intentionally unsupported; our zipSync v1 writer emits none of those formats. */
export function readBoundedBackupZip(bytes: Uint8Array, limits: { archive: number; inflated: number; entries: number }): Record<string, Uint8Array> {
  if (bytes.byteLength > limits.archive || bytes.byteLength < 22) invalid("El ZIP supera el límite o está incompleto.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at: number) => { if (at < 0 || at + 2 > bytes.length) invalid(); return view.getUint16(at, true); };
  const u32 = (at: number) => { if (at < 0 || at + 4 > bytes.length) invalid(); return view.getUint32(at, true); };
  let eocd = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--) {
    if (u32(at) === 0x06054b50 && at + 22 + u16(at + 20) === bytes.length) { eocd = at; break; }
  }
  if (eocd < 0 || u16(eocd + 4) || u16(eocd + 6) || u16(eocd + 8) !== u16(eocd + 10)) invalid();
  const count = u16(eocd + 10), centralSize = u32(eocd + 12), centralStart = u32(eocd + 16);
  if (count > limits.entries || count === 65535 || centralSize === 0xffffffff || centralStart === 0xffffffff || centralStart + centralSize !== eocd) invalid("El directorio del ZIP supera los límites o no es válido.");
  const entries: Record<string, Uint8Array> = Object.create(null);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let central = centralStart, localNext = 0, inflated = 0;
  for (let entry = 0; entry < count; entry++) {
    if (u32(central) !== 0x02014b50) invalid();
    const flags = u16(central + 8), method = u16(central + 10), crc = u32(central + 16), size = u32(central + 20), originalSize = u32(central + 24);
    const nameLength = u16(central + 28), extraLength = u16(central + 30), commentLength = u16(central + 32), offset = u32(central + 42);
    const nextCentral = central + 46 + nameLength + extraLength + commentLength;
    if (nextCentral > eocd || u16(central + 34) || (flags & ~0x0806) || ![0, 8].includes(method) || size === 0xffffffff || originalSize === 0xffffffff) invalid();
    if (originalSize > limits.inflated - inflated) invalid("El contenido real del ZIP supera el límite descomprimido.");
    const name = decoder.decode(bytes.subarray(central + 46, central + 46 + nameLength));
    assertSafeEntryName(name);
    if (name !== "manifest.json" && name !== "data.json" && !/^assets\/[a-f0-9]{64}$/.test(name)) invalid("Ruta fuera del formato de respaldo.");
    if (Object.hasOwn(entries, name)) invalid("El ZIP tiene rutas duplicadas.");
    if (offset !== localNext || u32(offset) !== 0x04034b50 || u16(offset + 6) !== flags || u16(offset + 8) !== method || u32(offset + 14) !== crc || u32(offset + 18) !== size || u32(offset + 22) !== originalSize) invalid("La cabecera local y el directorio del ZIP no coinciden.");
    const localNameLength = u16(offset + 26), localExtraLength = u16(offset + 28);
    if (localNameLength !== nameLength || decoder.decode(bytes.subarray(offset + 30, offset + 30 + localNameLength)) !== name) invalid();
    const begin = offset + 30 + localNameLength + localExtraLength, end = begin + size;
    if (begin > centralStart || end > centralStart) invalid();
    const chunks: Uint8Array[] = []; let actual = 0, checksum = 0xffffffff, finalSeen = false;
    const output = (chunk: Uint8Array, final: boolean) => {
      actual += chunk.byteLength; inflated += chunk.byteLength;
      if (actual > originalSize || inflated > limits.inflated) invalid("Los bytes realmente descomprimidos superan el tamaño declarado o el límite del respaldo.");
      for (const value of chunk) checksum = CRC_TABLE[(checksum ^ value) & 255] ^ (checksum >>> 8);
      chunks.push(chunk.slice()); finalSeen ||= final;
    };
    if (method === 0) output(bytes.subarray(begin, end), true);
    else {
      const stream = new Inflate(output);
      // Bound each callback's possible expansion too; never inflate a whole bomb
      // in one allocation before our output counter can reject it.
      for (let at = begin; at < end; at += 256) stream.push(bytes.subarray(at, Math.min(end, at + 256)), at + 256 >= end);
      if (begin === end) invalid();
    }
    if (!finalSeen || actual !== originalSize || ((checksum ^ 0xffffffff) >>> 0) !== crc) invalid("El tamaño real o CRC32 del archivo ZIP no coincide.");
    const result = new Uint8Array(actual); let copied = 0;
    for (const chunk of chunks) { result.set(chunk, copied); copied += chunk.byteLength; }
    entries[name] = result; central = nextCentral; localNext = end;
  }
  if (central !== eocd || localNext !== centralStart) invalid("El ZIP contiene entradas ocultas o un directorio inconsistente.");
  return entries;
}
