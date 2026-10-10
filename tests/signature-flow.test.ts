import assert from "node:assert/strict";
import { test } from "node:test";
import { formatSignatureCode, normalizeSignatureCode, signaturePortalUrl } from "../lib/public-config";
import { generateSignatureCode } from "../lib/server/signature/codes";
import {
  budgetDocumentHash,
  budgetDocumentPayload,
  signedDocumentHash,
  signatureIdentifierFor,
  type SignatureBudgetDocument,
} from "../lib/server/signature/document";
import {
  canonicalJson,
  computeSignatureEventHash,
  hashIp,
  maskEmail,
  maskPhone,
  sha256Hex,
  verifySignatureChain,
  type SignatureEventHashCore,
} from "../lib/server/signature/hash";
import {
  SIGNATURE_STATUSES,
  signatureBlocksSigning,
  signatureCanReject,
  signatureCanSign,
  signatureCanTransition,
  signatureEventTone,
  signatureIsExpired,
  SIGNATURE_RESEND_LIMIT_PER_REQUEST,
  SIGNATURE_RESEND_LIMIT_PER_USER,
  type SignatureStatusValue,
} from "../lib/server/signature/rules";
import { parseSignatureSubmission } from "../lib/server/signature/submission";
import { localSignatureProvider } from "../lib/server/signature/provider";
import { buildSignatureReminderMail, signatureDueText } from "../lib/server/mail/signature";
import {
  clampReminderDays,
  shouldRemindSignature,
  signatureReminderDaysLeft,
  signatureReminderWindow,
} from "../lib/server/signature/reminders";

/**
 * Flujo del portal de firma (issue #79), en funciones puras: estados y
 * transiciones, hash chain append-only, huellas del documento, validación del
 * envío del cliente y códigos públicos. Sin base de datos.
 */

// ── Código público ──────────────────────────────────────────────────────────

test("el código de firma tiene 20 caracteres legibles en grupos de cuatro", () => {
  for (let i = 0; i < 20; i += 1) {
    const code = generateSignatureCode();
    assert.match(code, /^[2-9A-HJ-NP-Z]{4}(-[2-9A-HJ-NP-Z]{4}){4}$/);
    assert.equal(normalizeSignatureCode(code), code);
  }
});

test("el código acepta link, path o texto suelto y rechaza formas inválidas", () => {
  const code = generateSignatureCode();
  const compact = code.replace(/-/g, "");
  assert.equal(normalizeSignatureCode(code.toLowerCase()), code);
  assert.equal(normalizeSignatureCode(`https://clientes.ledbox.online/firma/${code}`), code);
  assert.equal(normalizeSignatureCode(`/firma/${compact}`), code);
  assert.equal(normalizeSignatureCode("ABC"), null);
  assert.equal(normalizeSignatureCode("0".repeat(20)), null, "0 no pertenece al alfabeto");
  assert.equal(normalizeSignatureCode(""), null);
  assert.equal(signaturePortalUrl(code), `https://clientes.ledbox.online/firma/${code}`);
});

// ── Estados y transiciones ──────────────────────────────────────────────────

test("SIGNED no vuelve atrás y VALIDATED solo ocurre después de SIGNED", () => {
  for (const status of SIGNATURE_STATUSES) {
    assert.equal(signatureCanTransition("SIGNED", status), status === "VALIDATED");
    assert.equal(signatureCanTransition("VALIDATED", status), false);
  }
  assert.equal(signatureCanTransition("SIGNING", "SIGNED"), true);
  assert.equal(signatureCanTransition("SIGNING", "VALIDATED"), false, "no se saltea SIGNED");
  assert.equal(signatureCanTransition("PENDING_SIGNATURE", "SIGNING"), true);
  assert.equal(signatureCanTransition("VIEWED", "VALIDATED"), false);
});

test("REJECTED, EXPIRED y CANCELLED bloquean la firma para siempre", () => {
  for (const status of ["REJECTED", "EXPIRED", "CANCELLED"] as const) {
    assert.equal(signatureCanSign(status), false, `${status} no permite firmar`);
    assert.equal(signatureCanReject(status), false, `${status} no permite rechazar`);
    assert.equal(signatureBlocksSigning(status), true);
    assert.equal(signatureCanTransition(status, "SIGNED"), false);
    assert.equal(signatureCanTransition(status, "VIEWED"), false);
  }
  assert.equal(signatureCanSign("SENT"), true);
  assert.equal(signatureCanSign("VIEWED"), true);
  assert.equal(signatureCanSign("PENDING_SIGNATURE"), true);
  assert.equal(signatureBlocksSigning("SIGNED"), true, "firmada tampoco se vuelve a firmar");
  assert.equal(signatureBlocksSigning("VALIDATED"), true);
});

test("el vencimiento solo aplica a solicitudes activas", () => {
  const now = new Date("2026-09-27T12:00:00.000Z");
  const past = new Date("2026-09-26T12:00:00.000Z");
  assert.equal(signatureIsExpired("SENT", past, now), true);
  assert.equal(signatureIsExpired("VIEWED", past, now), true);
  assert.equal(signatureIsExpired("SIGNED", past, now), false, "una firmada no se vence");
  assert.equal(signatureIsExpired("REJECTED", past, now), false);
  assert.equal(signatureIsExpired("SENT", new Date("2026-09-28T12:00:00.000Z"), now), false);
});

// ── Hash chain ──────────────────────────────────────────────────────────────

function eventCore(overrides: Partial<SignatureEventHashCore> = {}): SignatureEventHashCore {
  return {
    id: "evt_1",
    requestId: "req_1",
    eventType: "REQUEST_CREATED",
    status: "SENT",
    occurredAt: new Date("2026-09-27T12:00:00.000Z"),
    actorType: "ADMIN",
    actorId: "admin_1",
    actorName: "Dario",
    ipHash: null,
    userAgentHash: null,
    metadataJson: { documento: "Presupuesto" },
    ...overrides,
  };
}

test("la cadena de eventos encadena hashes y detecta una alteración", () => {
  const first = eventCore();
  const hash1 = computeSignatureEventHash(first, null);
  const second = eventCore({ id: "evt_2", eventType: "VIEWED", status: "VIEWED", occurredAt: new Date("2026-09-27T12:05:00.000Z") });
  const hash2 = computeSignatureEventHash(second, hash1);

  const events = [
    { ...first, occurredAt: first.occurredAt as Date, previousEventHash: null, eventHash: hash1 },
    { ...second, occurredAt: second.occurredAt as Date, previousEventHash: hash1, eventHash: hash2 },
  ];
  assert.deepEqual(verifySignatureChain(events), { valid: true, brokenAt: null });

  // Alterar el contenido del primer evento rompe la cadena en ese eslabón.
  const tampered = [{ ...events[0], actorName: "Otro" }, events[1]];
  assert.deepEqual(verifySignatureChain(tampered), { valid: false, brokenAt: "evt_1" });

  // Cambiar el hash guardado del primero también se detecta.
  const fake = [{ ...events[0], eventHash: sha256Hex("otro") }, events[1]];
  assert.deepEqual(verifySignatureChain(fake), { valid: false, brokenAt: "evt_1" });
});

test("el JSON canónico ignora el orden de las claves y expone una huella estable", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: 2, c: [3, 1] } }), canonicalJson({ a: { c: [3, 1], d: 2 }, b: 1 }));
  assert.notEqual(canonicalJson({ a: [1, 2] }), canonicalJson({ a: [2, 1] }), "los arreglos conservan el orden");
  assert.equal(sha256Hex("ledbox"), sha256Hex("ledbox"));
});

test("IP y user-agent se protegen con hash y no quedan en claro", () => {
  const ip = hashIp("203.0.113.7");
  assert.ok(ip && ip.length === 64);
  assert.doesNotMatch(ip, /203\.0\.113/);
  assert.equal(hashIp("203.0.113.7"), ip, "misma IP, mismo hash");
  assert.equal(hashIp("unknown"), null);
  assert.equal(hashIp(""), null);
});

test("correo y teléfono se enmascaran en el portal", () => {
  assert.equal(maskEmail("ana.perez@acme.com"), "a***@acme.com");
  assert.equal(maskEmail(""), null);
  assert.equal(maskPhone("+595 981 123 456"), "••• 456");
  assert.equal(maskPhone(null), null);
});

// ── Documento y sello ───────────────────────────────────────────────────────

function budgetDocument(): SignatureBudgetDocument {
  return {
    budgetId: "bud_1",
    reference: "P-0001",
    title: "Alquiler de pantallas",
    organizationName: "LedBox",
    client: { name: "Ana", company: "Acme S.A." },
    event: null,
    createdAt: "2026-09-27T12:00:00.000Z",
    validUntil: null,
    deliveryAt: null,
    ivaType: null,
    warranty: null,
    notes: null,
    paymentTerms: null,
    items: [{ name: "Pantalla LED", quantity: 2, days: 1, unitPrice: 900_000, subtotal: 1_800_000, notes: null }],
    subtotal: 1_800_000,
    discount: 0,
    total: 1_800_000,
    plan: { advanceAmount: 0, installments: [], dueNow: { label: "Pago único", amount: 1_800_000 }, pending: 0 },
  };
}

test("la huella del documento cambia si cambia el documento", () => {
  const base = budgetDocumentHash(budgetDocumentPayload(budgetDocument()));
  const same = budgetDocumentHash(budgetDocumentPayload(budgetDocument()));
  assert.equal(base, same);
  const changed = budgetDocument();
  changed.items[0].quantity = 3;
  assert.notEqual(budgetDocumentHash(budgetDocumentPayload(changed)), base);
  // Los costos internos no existen en el documento firmable.
  const payload = budgetDocumentPayload(budgetDocument());
  assert.doesNotMatch(JSON.stringify(payload), /cost/i);
});

test("legacy v1 conserva receta y hash exactos sin campos nuevos null ni identidad inferida", () => {
  const document = budgetDocument();
  assert.equal(budgetDocumentHash(budgetDocumentPayload(document)), "b8785d8d9ddb2e7fbf7e7884fbcec966d8aa45f4ab647a9412cfe09330df3c4c");
  document.client.tradeName = "Nuevo fantasía"; document.client.legalName = "Nueva razón social";
  assert.equal(budgetDocumentHash(budgetDocumentPayload(document)), "b8785d8d9ddb2e7fbf7e7884fbcec966d8aa45f4ab647a9412cfe09330df3c4c");
  assert.doesNotMatch(JSON.stringify(budgetDocumentPayload(document)), /documentVersion|displayName|tradeName|legalName/);
});

test("excluding a free line invalidates the commercial signature without repricing originals", () => {
  const document = budgetDocument();
  document.items.push({ name: "Brindis", quantity: 1, days: 1, unitPrice: 0, subtotal: 0, notes: null });
  const original = budgetDocumentHash(budgetDocumentPayload(document));
  document.items[1].excluded = true;
  assert.notEqual(budgetDocumentHash(budgetDocumentPayload(document)), original);
  assert.equal(document.total, 1_800_000);
  assert.equal(document.items[1].unitPrice, 0);
  document.items[1].excluded = false;
  assert.equal(budgetDocumentHash(budgetDocumentPayload(document)), original);
});

test("la huella firmada incorpora identificador, método y firmante", () => {
  const input = {
    documentHash: "a".repeat(64),
    signatureIdentifier: "FIRMA-20260927-ABCDEF12",
    signedAt: new Date("2026-09-27T12:30:00.000Z"),
    provider: "local",
    method: "DRAWN",
    signerName: "Ana Pérez",
  };
  const hash = signedDocumentHash(input);
  assert.equal(hash, signedDocumentHash(input));
  assert.notEqual(hash, signedDocumentHash({ ...input, signerName: "Otra Persona" }));
  assert.match(signatureIdentifierFor(new Date("2026-09-27T12:30:00.000Z"), "ab12cd34"), /^FIRMA-20260927-AB12CD34$/);
});

// ── Envío del cliente ───────────────────────────────────────────────────────

function pngDataUrl(size = 400): string {
  const bytes = new Uint8Array(size);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
}

test("la firma dibujada exige un PNG real con tinta suficiente", () => {
  const ok = parseSignatureSubmission("DRAWN", { dataUrl: pngDataUrl(400) }, "Ana Pérez");
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.value.kind, "drawn");
    assert.equal(ok.signerName, "Ana Pérez");
  }
  const empty = parseSignatureSubmission("DRAWN", { dataUrl: pngDataUrl(80) }, "Ana Pérez");
  assert.equal(empty.ok, false, "un canvas casi vacío no es una firma");
  const wrongMime = parseSignatureSubmission("DRAWN", { dataUrl: "data:image/jpeg;base64,AAAA" }, "Ana");
  assert.equal(wrongMime.ok, false);
  const fake = parseSignatureSubmission("DRAWN", { dataUrl: `data:image/png;base64,${Buffer.from(new Uint8Array(400)).toString("base64")}` }, "Ana");
  assert.equal(fake.ok, false, "sin magic bytes PNG no pasa");
  const huge = parseSignatureSubmission("DRAWN", { dataUrl: pngDataUrl(600 * 1024) }, "Ana");
  assert.equal(huge.ok, false, "más de 512 KB no pasa");
});

test("la firma tipográfica valida el nombre", () => {
  const ok = parseSignatureSubmission("TYPED", { name: "Ana María Pérez" }, "Ana");
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.signerName, "Ana María Pérez");
  assert.equal(parseSignatureSubmission("TYPED", { name: "A" }, "Ana").ok, false);
  assert.equal(parseSignatureSubmission("TYPED", { name: "Ana <script>" }, "Ana").ok, false);
  assert.equal(parseSignatureSubmission("TYPED", {}, "Ana").ok, false);
});

// ── Proveedor local ─────────────────────────────────────────────────────────

test("el proveedor local devuelve identificador, sello y huella encadenada al documento", async () => {
  const result = await localSignatureProvider.sign({
    request: { id: "req_1", title: "Contrato", method: "TYPED", documentHash: "b".repeat(64), recipientName: "Ana Pérez" },
    signature: { kind: "typed", name: "Ana Pérez" },
    now: new Date("2026-09-27T12:30:00.000Z"),
  });
  assert.equal(result.provider, "local");
  assert.match(result.identifier, /^FIRMA-\d{8}-[0-9A-F]{8}$/);
  assert.equal(result.signedDocumentHash.length, 64);
  assert.equal(result.signature.type, "SIGNATURE");
  assert.equal(result.signature.status, "COMPLETED");
  assert.equal(result.timestamp.type, "TIMESTAMP");
  assert.equal(result.seal.type, "SEAL");
  assert.equal(result.signature.data, null, "la tipográfica no guarda binario");
});

test("los estados del contrato incluyen los once del documento", () => {
  assert.deepEqual(SIGNATURE_STATUSES, [
    "DRAFT",
    "SENT",
    "DELIVERED",
    "VIEWED",
    "PENDING_SIGNATURE",
    "SIGNING",
    "SIGNED",
    "VALIDATED",
    "REJECTED",
    "EXPIRED",
    "CANCELLED",
  ] satisfies SignatureStatusValue[]);
  assert.equal(formatSignatureCode("ABCDEFGHJKLMNPQRSTUV"), "ABCD-EFGH-JKLM-NPQR-STUV");
});

// ── Recordatorio de vencimiento (issue #81) ─────────────────────────────────

test("la ventana del recordatorio termina al fin del día de Asunción de hoy + días", () => {
  const now = new Date("2026-09-27T12:00:00.000Z"); // 09:00 en Asunción
  const { dayKey, windowEnd } = signatureReminderWindow(now, 3);
  assert.equal(dayKey, "2026-09-27");
  // 01-10 00:00 en Asunción (UTC-3) = 03:00 UTC: cubre los 3 días completos.
  assert.equal(windowEnd.toISOString(), "2026-10-01T03:00:00.000Z");
});

test("los días restantes se miden por día de Asunción", () => {
  const now = new Date("2026-09-27T12:00:00.000Z"); // 27/09 09:00 Asunción (UTC-3)
  assert.equal(signatureReminderDaysLeft(new Date("2026-09-30T02:00:00.000Z"), now), 2); // 29/09 23:00 Asunción
  assert.equal(signatureReminderDaysLeft(new Date("2026-10-01T02:00:00.000Z"), now), 3); // 30/09 23:00 Asunción
  assert.equal(signatureReminderDaysLeft(new Date("2026-09-27T12:00:00.000Z"), now), 0);
  assert.equal(signatureReminderDaysLeft(new Date("2026-09-26T12:00:00.000Z"), now), -1);
});

test("solo se recuerda una solicitud activa, sin vencer, dentro de la ventana y sin correo de hoy", () => {
  const now = new Date("2026-09-27T12:00:00.000Z");
  const { windowEnd } = signatureReminderWindow(now, 3);
  const base = { now, windowEnd, emailedToday: false };
  assert.equal(shouldRemindSignature({ ...base, status: "VIEWED", expiresAt: new Date("2026-09-29T12:00:00.000Z") }), true);
  assert.equal(shouldRemindSignature({ ...base, status: "SENT", expiresAt: windowEnd }), false, "el límite es exclusivo");
  assert.equal(shouldRemindSignature({ ...base, status: "SIGNED", expiresAt: new Date("2026-09-28T12:00:00.000Z") }), false);
  assert.equal(shouldRemindSignature({ ...base, status: "VALIDATED", expiresAt: new Date("2026-09-28T12:00:00.000Z") }), false);
  assert.equal(shouldRemindSignature({ ...base, status: "CANCELLED", expiresAt: new Date("2026-09-28T12:00:00.000Z") }), false);
  assert.equal(shouldRemindSignature({ ...base, status: "VIEWED", expiresAt: new Date("2026-09-27T11:00:00.000Z") }), false, "vencida no se recuerda");
  assert.equal(
    shouldRemindSignature({ ...base, emailedToday: true, status: "VIEWED", expiresAt: new Date("2026-09-28T12:00:00.000Z") }),
    false,
    "un correo de hoy (aviso, reenvío o recordatorio) alcanza",
  );
});

test("los días de antelación se normalizan entre 1 y 15 (default 3)", () => {
  assert.equal(clampReminderDays(undefined), 3);
  assert.equal(clampReminderDays("0"), 3);
  assert.equal(clampReminderDays("-2"), 3);
  assert.equal(clampReminderDays(2), 2);
  assert.equal(clampReminderDays("30"), 15);
});

test("el correo de recordatorio lleva el código, el link y cuánto falta", () => {
  const mail = buildSignatureReminderMail({
    organizationName: "LedBox",
    title: "Alquiler de pantallas",
    recipientName: "Ana Pérez",
    senderName: "Dario Deoli",
    code: "ABCD-EFGH-JKLM-NPQR-STUV",
    portalUrl: "https://clientes.ledbox.online/firma/ABCD-EFGH-JKLM-NPQR-STUV",
    expiresAt: new Date("2026-09-30T03:00:00.000Z"),
    daysLeft: 3,
    methodLabel: "Firma dibujada",
  });
  assert.match(mail.subject, /Recordatorio/);
  assert.match(mail.subject, /vence en 3 días/);
  assert.match(mail.html, /ABCD-EFGH-JKLM-NPQR-STUV/);
  assert.match(mail.html, /https:\/\/clientes\.ledbox\.online\/firma\//);
  assert.match(mail.text, /vence en 3 días/);
  assert.equal(signatureDueText(0), "vence hoy");
  assert.equal(signatureDueText(1), "vence mañana");
});

test("el envío manual por correo tiene rate limit por solicitud y por usuario", () => {
  assert.ok(SIGNATURE_RESEND_LIMIT_PER_REQUEST >= 1 && SIGNATURE_RESEND_LIMIT_PER_REQUEST <= 10);
  assert.ok(SIGNATURE_RESEND_LIMIT_PER_USER >= SIGNATURE_RESEND_LIMIT_PER_REQUEST);
});

test("los eventos de firma tienen tono por significado (panel y portal)", () => {
  assert.equal(signatureEventTone("EMAIL_FAILED"), "danger");
  assert.equal(signatureEventTone("REJECTED"), "danger");
  assert.equal(signatureEventTone("SIGNATURE_RECEIVED"), "ok");
  assert.equal(signatureEventTone("DOCUMENT_VALIDATED"), "ok");
  assert.equal(signatureEventTone("VIEWED"), "accent");
  assert.equal(signatureEventTone("EMAIL_SENT"), "info");
  assert.equal(signatureEventTone("OTP_VALIDATED"), "info");
  assert.equal(signatureEventTone("OTRO"), "neutral");
});
