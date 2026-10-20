import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { summarizeDnsEvidence } from "../scripts/verify-eventos-external";

describe("verificación pública DNS de EventOS", () => {
  it("detecta publicación DNS de Cloudflare y remitente sin revelar valores", () => {
    const checks = summarizeDnsEvidence("weem.com.py", {
      nameservers: ["ray.ns.cloudflare.com"],
      mx: [{ exchange: "route1.mx.cloudflare.net" }],
      txt: ["v=spf1 include:amazonses.com ~all"],
      dmarcTxt: ["v=DMARC1; p=none;"],
      dkimPresent: true,
      returnMx: [{ exchange: "feedback-smtp.example.invalid" }],
      returnTxt: ["v=spf1 include:amazonses.com ~all"],
    });

    assert.equal(checks.every((check) => check.status === "PASS"), true);
    assert.equal(checks.some((check) => check.detail.includes("amazonses.com")), false);
    assert.equal(checks.some((check) => check.detail.includes("p=none")), true);
  });

  it("distingue ausencia de registros de una verificación del proveedor", () => {
    const checks = summarizeDnsEvidence("example.invalid", {
      nameservers: [], mx: [], txt: [], dmarcTxt: [], dkimPresent: false,
    });

    assert.equal(checks[0].status, "FAIL");
    assert.equal(checks.slice(1).every((check) => check.status === "WARN"), true);
    assert.equal(checks.some((check) => /verificado|activo/i.test(check.detail)), false);
  });
});
