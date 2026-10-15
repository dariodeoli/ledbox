import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DEFAULT_IMAGE_FRAMING, boundedImageFraming, identityImageSize, imageFramingRect, initialImageFraming } from "../lib/image-framing";
import { prepareIdentityImage } from "../lib/identity-image";

test("logo conserva toda la imagen; avatar ofrece ajuste completo y centrado equivalentes al recorte anterior", () => {
  assert.deepEqual(imageFramingRect(400, 200, 400, 200, DEFAULT_IMAGE_FRAMING), { x: 0, y: 0, width: 400, height: 200, travelX: 0, travelY: 0 });
  assert.deepEqual(imageFramingRect(400, 200, 200, 200, DEFAULT_IMAGE_FRAMING), { x: 0, y: 50, width: 200, height: 100, travelX: 0, travelY: 50 });
  assert.deepEqual(initialImageFraming(400, 200, true), { zoom: 2, x: 0, y: 0 });
  assert.deepEqual(imageFramingRect(400, 200, 200, 200, initialImageFraming(400, 200, true)), { x: -100, y: 0, width: 400, height: 200, travelX: 100, travelY: 0 });
  assert.deepEqual(initialImageFraming(400, 200, false), DEFAULT_IMAGE_FRAMING);
  assert.deepEqual(identityImageSize(6000, 4000, true, 512), { width: 341, height: 341 });
  assert.deepEqual(identityImageSize(6000, 4000, false, 1024), { width: 1024, height: 683 });
});

test("zoom y desplazamiento se limitan sin NaN y los extremos mueven hasta el borde", () => {
  assert.deepEqual(boundedImageFraming({ zoom: 100, x: -5, y: 3 }), { zoom: 8, x: -1, y: 1 });
  assert.deepEqual(boundedImageFraming({ zoom: NaN, x: Infinity, y: NaN }), DEFAULT_IMAGE_FRAMING);
  const left = imageFramingRect(400, 200, 200, 200, { zoom: 2, x: -1, y: 0 });
  const right = imageFramingRect(400, 200, 200, 200, { zoom: 2, x: 1, y: 0 });
  assert.equal(left.x, -200); assert.equal(right.x, 0);
});

test("preparación real usa la misma geometría del canvas, comprime y mantiene el tope de 1 MB", async () => {
  const old = { document: globalThis.document, createImageBitmap: globalThis.createImageBitmap, FileReader: globalThis.FileReader };
  const calls: unknown[][] = [];
  let closed = 0, decodes = 0, blobBytes = 20;
  const image = { width: 400, height: 200, close: () => { closed += 1; } };
  const context = { drawImage: (...args: unknown[]) => calls.push(args) };
  const canvas = { width: 0, height: 0, getContext: () => context, toBlob: (callback: (blob: Blob) => void) => callback(new Blob([new Uint8Array(blobBytes)], { type: "image/webp" })) };
  class Reader {
    result: string | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    readAsDataURL(blob: Blob) { void blob.arrayBuffer().then((bytes) => { this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString("base64")}`; this.onload?.(); }); }
  }
  Object.assign(globalThis, { document: { createElement: () => canvas }, createImageBitmap: async () => { decodes += 1; return image; }, FileReader: Reader });
  const file = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0, 0, 0, 0, 0])], "real-header.png", { type: "image/png" });
  try {
    const framing = { zoom: 3, x: .5, y: -.5 };
    const result = await prepareIdentityImage(file, { square: true, maxSide: 512, framing });
    assert.ok(result.ok);
    if (result.ok) { assert.equal(result.image.width, 200); assert.equal(result.image.height, 200); assert.equal(result.image.mime, "image/webp"); assert.equal(result.image.size, 20); }
    const rect = imageFramingRect(400, 200, 200, 200, framing);
    assert.deepEqual(calls[0], [image, rect.x, rect.y, rect.width, rect.height]);
    assert.equal(closed, 1);
    const before = decodes;
    assert.equal((await prepareIdentityImage(new File(["%PDF renamed"], "fake.png", { type: "image/png" }), { square: false, maxSide: 1024 })).ok, false);
    assert.equal(decodes, before, "el MIME falso se rechaza antes de decodificar");
    blobBytes = 1024 * 1024 + 1;
    const oversized = await prepareIdentityImage(file, { square: false, maxSide: 1024, framing });
    assert.equal(oversized.ok, false); if (!oversized.ok) assert.match(oversized.error, /1 MB/);
    assert.equal(closed, 2, "también libera la imagen tras rechazar el peso");
  } finally { Object.assign(globalThis, old); }
});

test("las tres identidades usan el editor compartido y preparar no se dispara al seleccionar archivo", () => {
  const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const source = read("components/admin/AdminUI.tsx");
  const uploader = source.slice(source.indexOf("export function AdminImageUpload"), source.indexOf("export function AdminIdentityImageEditor"));
  assert.doesNotMatch(uploader, /await prepareIdentityImage\(/, "seleccionar sólo abre editor, sin subir ni comprimir antes");
  assert.match(uploader, /setEditing\(\{ file, epoch \}\)/);
  assert.match(uploader, /onApply=\{\(image\) => acceptImage\(image, editing\.epoch\)\}/);
  assert.match(uploader, /if \(!current\(epoch\)\) return;[\s\S]*setEditing\(null\); onPrepared\(image\)/);
  assert.match(source, /prepareIdentityImage\(file, \{ square, maxSide, framing \}\)/);
  assert.match(source, /identityImageSize\(loaded.width, loaded.height, square, maxSide\)/);
  assert.match(source, /context.drawImage\(loaded.image, rect.x, rect.y, rect.width, rect.height\)/);
  assert.match(source, /source.origin !== window.location.origin/);
  assert.match(source, /credentials: "same-origin"/);
  assert.match(source, /onPointerMove=\{move\}/); assert.match(source, /ArrowLeft/); assert.match(source, /Ajustar completa/);
  assert.match(read("components/admin/modules/PerfilModule.tsx"), /editSrc=\{avatarSrc\}/);
  assert.match(read("components/admin/modules/EmpresaModule.tsx"), /editSrc=\{logoSrc\(variant\)\}/);
  assert.match(read("components/admin/modules/ClientesModule.tsx"), /editSrc=\{previewLogoSrc\}/);
});
