import assert from "node:assert/strict";
import { test } from "node:test";
import { siteProfileForHost } from "../lib/public-config";

test("EventOS recognizes the exact eventoss.online domain and its subdomains", () => {
  assert.equal(siteProfileForHost("eventoss.online").kind, "eventos");
  assert.equal(siteProfileForHost("www.eventoss.online").kind, "eventos");
  assert.equal(siteProfileForHost("eventoss.online.evil.example").kind, "ledbox");
});

test("EventOS domains can be configured as comma-separated apex domains", () => {
  const previous = process.env.NEXT_PUBLIC_EVENTOS_DOMAINS;
  process.env.NEXT_PUBLIC_EVENTOS_DOMAINS = "sales.example, marketing.example ";
  try {
    assert.equal(siteProfileForHost("sales.example").kind, "eventos");
    assert.equal(siteProfileForHost("app.sales.example").kind, "eventos");
    assert.equal(siteProfileForHost("www.marketing.example").kind, "eventos");
    assert.equal(siteProfileForHost("eventoss.online").kind, "ledbox");
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_EVENTOS_DOMAINS;
    else process.env.NEXT_PUBLIC_EVENTOS_DOMAINS = previous;
  }
});

test("configured EventOS app host stays non-indexable and LedBox host stays unchanged", () => {
  const previousApp = process.env.NEXT_PUBLIC_APP_URL;
  const previousAdmin = process.env.NEXT_PUBLIC_ADMIN_URL;
  process.env.NEXT_PUBLIC_APP_URL = "https://app.eventoss.online";
  process.env.NEXT_PUBLIC_ADMIN_URL = "https://app.eventoss.online";
  try {
    assert.equal(siteProfileForHost("app.eventoss.online").kind, "app");
    assert.equal(siteProfileForHost("app.eventoss.online").indexable, false);
    assert.equal(siteProfileForHost("ledbox.online").kind, "ledbox");
  } finally {
    if (previousApp === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = previousApp;
    if (previousAdmin === undefined) delete process.env.NEXT_PUBLIC_ADMIN_URL;
    else process.env.NEXT_PUBLIC_ADMIN_URL = previousAdmin;
  }
});
