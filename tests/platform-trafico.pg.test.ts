import assert from "node:assert/strict";
import { test } from "node:test";

// Opt-in: necesita un Postgres descartable con las migraciones aplicadas.
//   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:<puerto>/<base> node --import tsx --test tests/platform-trafico.pg.test.ts
test("tráfico: beacon, rate limit, agregados por host, demo_start y panel ignorado en PostgreSQL", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "solo una base local descartable");
  process.env.DATABASE_URL = url.toString();
  process.env.AUTH_SECRET ||= "dev-secret-dev-secret-dev-secret";
  const { db } = await import("../lib/server/db");
  const metrics = await import("../lib/server/web-metrics");
  const queries = await import("../lib/platform/queries/trafico");
  const { traficoRange } = await import("../lib/platform/trafico-range");
  const { visitorHash } = await import("../lib/platform/trafico-core");

  const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
  const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
  const SITE = "ledbox.online";
  const DEMO = "demo.ledbox.online";

  const pending: Promise<void>[] = [];
  const schedule = (work: () => Promise<void>) => { pending.push(work()); };
  const settle = async () => { await Promise.all(pending.splice(0)); };
  let counter = 0;
  const id = (prefix: string) => `${prefix}-${String(++counter).padStart(8, "0")}`;

  function beaconRequest(body: Record<string, unknown>, init?: { ip?: string; ua?: string; headers?: Record<string, string> }) {
    return new Request(`https://${body.host}/api/metrics/view`, {
      method: "POST",
      headers: { "user-agent": init?.ua ?? CHROME, "x-forwarded-for": init?.ip ?? "190.104.5.77", "content-type": "text/plain", ...(init?.headers ?? {}) },
      body: JSON.stringify(body),
    });
  }
  async function send(body: Record<string, unknown>, init?: Parameters<typeof beaconRequest>[1], now?: Date) {
    const response = await metrics.handleViewBeacon(beaconRequest(body, init), { schedule, now, random: () => 1 });
    await settle();
    return response;
  }
  const view = (over: Record<string, unknown> = {}) => ({ viewId: id("view"), sessionId: id("sess"), host: SITE, path: "/", referrer: null, isEntry: true, ...over });
  const rowsOf = (viewId: string) => db.$queryRaw<Array<Record<string, unknown>>>`SELECT * FROM "WebView" WHERE "viewId" = ${viewId}`;
  const count = async (where = "TRUE") => Number((await db.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM "WebView" WHERE ${where}`))[0].n);
  const reset = async () => {
    await db.$executeRawUnsafe(`DELETE FROM "WebView"`);
    await db.$executeRawUnsafe(`DELETE FROM "DemoSession"`);
    await db.$executeRawUnsafe(`DELETE FROM "RateLimitBucket" WHERE "key" LIKE 'metrics:view:%'`);
  };
  await reset();

  try {
    await t.test("el beacon de duración actualiza la misma vista, sin duplicar ni retroceder, y no guarda IP ni UA", async () => {
      const first = view({ path: "/productos/pantalla-led?utm=1#x" });
      const created = await send(first);
      assert.equal(created.status, 204);
      let rows = await rowsOf(first.viewId as string);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].durationSec, null);
      assert.equal(rows[0].path, "/productos/pantalla-led");

      await send({ ...first, durationSec: 12, scrollPct: 80 });
      await send({ ...first, durationSec: 5, scrollPct: 30 }); // beacon viejo o repetido: no retrocede
      await send({ ...first, durationSec: 12, scrollPct: 80 }); // idéntico: idempotente
      rows = await rowsOf(first.viewId as string);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].durationSec, 12);
      assert.equal(rows[0].scrollPct, 80);
      assert.equal(rows[0].isEntry, true);
      assert.equal(rows[0].device, "desktop");
      assert.equal(rows[0].country, null);
      assert.equal(rows[0].visitorHash, visitorHash({ secret: process.env.AUTH_SECRET!, ip: "190.104.5.77", ua: CHROME, now: new Date() }));

      const dump = JSON.stringify(rows[0]);
      assert.ok(!dump.includes("190.104.5.77") && !dump.includes("Mozilla"), "ni IP ni UA en la fila");

      // Otro visitante no puede tocar la vista ajena aunque conozca el viewId.
      await send({ ...first, durationSec: 999, scrollPct: 100 }, { ip: "10.9.9.9" });
      assert.equal((await rowsOf(first.viewId as string))[0].durationSec, 12);

      // El beacon de cierre puede llegar antes que la vista: crea la fila y la vista tardía no la pisa.
      const late = view();
      await send({ ...late, durationSec: 7, scrollPct: 40 });
      await send({ ...late });
      rows = await rowsOf(late.viewId as string);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].durationSec, 7);
    });

    await t.test("el país solo se guarda si el proxy lo manda; el referrer queda reducido al dominio; móvil por UA", async () => {
      const v = view({ referrer: "https://www.google.com/search?q=led+secreto" });
      await send(v, { ua: IPHONE, headers: { "cf-ipcountry": "PY" } });
      const row = (await rowsOf(v.viewId as string))[0];
      assert.equal(row.country, "PY");
      assert.equal(row.referrerHost, "google.com");
      assert.equal(row.device, "mobile");
      assert.ok(!JSON.stringify(row).includes("secreto"));
    });

    await t.test("rate limit por visitante: pasado el tope no se guarda más y la respuesta sigue siendo 204", async () => {
      await reset();
      const ip = "201.222.1.9";
      let last: Response | null = null;
      for (let i = 0; i < metrics.VIEW_RATE_LIMIT + 5; i += 1) last = await send(view(), { ip });
      assert.equal(last!.status, 204);
      assert.equal(await count(), metrics.VIEW_RATE_LIMIT, "se guardan exactamente VIEW_RATE_LIMIT");
      // Otro visitante no se ve afectado.
      await send(view(), { ip: "201.222.1.10" });
      assert.equal(await count(), metrics.VIEW_RATE_LIMIT + 1);
    });

    await t.test("se ignoran: panel (app.), paths de /superadmin y /api, hosts ajenos, Origin ajeno, bots, DNT, cuerpo roto; todo 204", async () => {
      await reset();
      const cases: Array<[string, Promise<Response>]> = [
        ["panel", send(view({ host: "app.ledbox.online", path: "/dashboard" }))],
        ["panel viejo", send(view({ host: "admin.ledbox.online", path: "/eventos" }))],
        ["superadmin", send(view({ path: "/superadmin/actividad" }))],
        ["api", send(view({ path: "/api/leads" }))],
        ["host ajeno", send(view({ host: "evil.com" }))],
        ["origin ajeno", send(view(), { headers: { origin: "https://evil.com" } })],
        ["bot", send(view(), { ua: "Googlebot/2.1 (+http://www.google.com/bot.html)" })],
        ["dnt", send(view(), { headers: { dnt: "1" } })],
        ["roto", metrics.handleViewBeacon(new Request(`https://${SITE}/api/metrics/view`, { method: "POST", headers: { "user-agent": CHROME }, body: "{no es json" }), { schedule })],
        ["enorme", metrics.handleViewBeacon(new Request(`https://${SITE}/api/metrics/view`, { method: "POST", headers: { "user-agent": CHROME }, body: JSON.stringify({ ...view(), referrer: "x".repeat(5000) }) }), { schedule })],
      ];
      for (const [name, promise] of cases) assert.equal((await promise).status, 204, name);
      await settle();
      assert.equal(await count(), 0, "ninguna se guardó");
      assert.equal(Number((await db.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM "DemoSession"`)[0].n), 0);
      // En cambio la demo y el sitio sí cuentan.
      await send(view({ host: DEMO, path: "/finanzas" }));
      await send(view({ host: `www.${SITE}`, path: "/" }));
      assert.equal(await count(`"host" = '${DEMO}'`), 1);
      assert.equal(await count(`"host" = '${SITE}'`), 1, "www se guarda como el sitio");
      assert.equal(await count(), 2);
    });

    await t.test("agregados por host, días de Paraguay, top páginas, referrers, dispositivos y hoy vs ayer", async () => {
      await reset();
      const now = new Date("2026-10-14T18:00:00Z"); // 15:00 en Paraguay
      const v = async (over: Record<string, unknown>, at: string, init?: Parameters<typeof beaconRequest>[1]) => send(view(over), init, new Date(at));
      // Sitio, hoy: sesión A (2 vistas, 40 s), sesión B (1 vista, 4 s = rebote), sesión C (1 vista, 30 s).
      const sA = id("sess"), sB = id("sess"), sC = id("sess");
      await v({ sessionId: sA, path: "/", referrer: "https://www.google.com/", durationSec: 20, scrollPct: 60 }, "2026-10-14T13:00:00Z");
      await v({ sessionId: sA, path: "/productos/pantalla-led", isEntry: false, durationSec: 20, scrollPct: 100 }, "2026-10-14T13:01:00Z");
      await v({ sessionId: sB, path: "/", durationSec: 4, scrollPct: 10 }, "2026-10-14T14:00:00Z", { ip: "181.1.1.1", ua: IPHONE });
      await v({ sessionId: sC, path: "/", referrer: "https://l.instagram.com/", durationSec: 30, scrollPct: 50 }, "2026-10-14T15:00:00Z", { ip: "181.1.1.2" });
      // Período anterior (7d previos) y ayer en el mismo tramo.
      await v({ path: "/", durationSec: 9 }, "2026-10-13T13:30:00Z", { ip: "181.1.1.3" }); // ayer, mismo tramo (antes de 18:00)
      await v({ path: "/" }, "2026-10-13T20:00:00Z", { ip: "181.1.1.4" }); // ayer, después del tramo
      await v({ path: "/" }, "2026-10-04T13:00:00Z", { ip: "181.1.1.5" }); // período anterior
      // Borde de zona horaria: 02:30 UTC del 14 es el 13 en Paraguay.
      await v({ path: "/contacto" }, "2026-10-14T02:30:00Z", { ip: "181.1.1.6" });
      // Demo y portal en su propio host.
      await v({ host: DEMO, path: "/finanzas", durationSec: 60 }, "2026-10-14T16:00:00Z", { ip: "181.1.1.7" });
      await v({ host: "clientes.ledbox.online", path: "/p/lbxq_SECRETO1234567890", durationSec: 15 }, "2026-10-14T16:00:00Z", { ip: "181.1.1.8" });

      const range = traficoRange("hoy", now);
      const hosts = await queries.getTraficoPorHost(range);
      const site = hosts.find((h) => h.host === SITE)!;
      assert.equal(site.views, 4);
      assert.equal(site.sessions, 3);
      assert.equal(site.visitors, 3);
      assert.equal(site.viewsPrev, 3, "ayer: 2 del día + la de 02:30 UTC que cae en el 13");
      assert.equal(site.viewsDelta, 33.3);
      assert.equal(site.avgSec, 18.5);
      assert.equal(site.medianSec, 20);
      assert.equal(site.avgScrollPct, 55);
      assert.equal(site.bounceRate, 33.3, "1 de 3 sesiones: una vista y menos de 10 s");
      assert.equal(site.isDemo, false);
      assert.equal(hosts.find((h) => h.host === DEMO)!.isDemo, true);
      assert.ok(hosts.find((h) => h.host === "clientes.ledbox.online"));

      const portalPaths = await queries.getTopPaginas(range, { host: "clientes.ledbox.online" });
      assert.deepEqual(portalPaths.map((p) => p.path), ["/p/:token"]);
      assert.ok(!JSON.stringify(portalPaths).includes("SECRETO"));

      const pages = await queries.getTopPaginas(range, { host: SITE });
      assert.deepEqual(pages.map((p) => [p.path, p.views]), [["/", 3], ["/productos/pantalla-led", 1]]);

      const refs = await queries.getTopReferrers(range, { host: SITE });
      assert.deepEqual(refs.top.map((r) => [r.referrerHost, r.views]).sort(), [["google.com", 1], ["l.instagram.com", 1]]);
      assert.equal(refs.directViews, 2);
      assert.equal(refs.totalViews, 4);

      const devices = await queries.getDispositivos(range, { host: SITE });
      assert.deepEqual([devices.mobile, devices.desktop, devices.mobilePct], [1, 3, 25]);

      const series = await queries.getVistasPorDia(traficoRange("7d", now), { host: SITE });
      assert.equal(series.current.length, 7);
      assert.equal(series.previous.length, 7);
      const byDay = Object.fromEntries(series.current.map((d) => [d.day, d.views]));
      assert.equal(byDay["2026-10-14"], 4);
      assert.equal(byDay["2026-10-13"], 3, "la de 02:30 UTC cuenta en el día anterior de Paraguay");
      assert.equal(byDay["2026-10-12"], 0);
      assert.equal(series.previous.reduce((n, d) => n + d.views, 0), 1);

      const today = await queries.getHoy(now, { host: SITE });
      assert.equal(today.today, 4);
      assert.equal(today.yesterdaySameSlice, 1, "ayer hasta las 15:00 de Paraguay: solo la de 10:30 (la de 23:30 y la de 17:00 quedan fuera)");
      assert.equal(today.delta, 300);
    });

    await t.test("demo_start desde /api/demo/session: una por visitante cada 30 min, sin bots, y se une a sus vistas", async () => {
      await reset();
      const demoRequest = (init?: { ip?: string; ua?: string; headers?: Record<string, string> }) =>
        new Request(`https://${DEMO}/api/demo/session?next=/dashboard`, {
          headers: { "user-agent": init?.ua ?? CHROME, "x-forwarded-for": init?.ip ?? "190.50.5.5", ...(init?.headers ?? {}) },
        });
      const start = new Date("2026-10-14T15:00:00Z");
      assert.equal(metrics.scheduleDemoStart(demoRequest(), { schedule, now: start }), true);
      await settle();
      metrics.scheduleDemoStart(demoRequest(), { schedule, now: new Date("2026-10-14T15:10:00Z") }); // recarga: misma demo
      assert.equal(metrics.scheduleDemoStart(demoRequest({ ua: "Googlebot/2.1 (+http://www.google.com/bot.html)" }), { schedule, now: start }), false);
      assert.equal(metrics.scheduleDemoStart(demoRequest({ headers: { dnt: "1" } }), { schedule, now: start }), false);
      await settle();
      metrics.scheduleDemoStart(demoRequest({ ip: "190.50.5.6" }), { schedule, now: new Date("2026-10-14T15:11:00Z") });
      await settle();
      const sessions = await db.$queryRaw<Array<{ sessionId: string | null; modules: string[]; durationSec: number }>>`SELECT "sessionId","modules","durationSec" FROM "DemoSession" ORDER BY "startedAt"`;
      assert.equal(sessions.length, 2, "recarga, bot y DNT no suman");
      assert.equal(sessions[0].sessionId, null);

      // El visitante navega la demo: sus vistas se unen a la sesión y suman módulos y duración.
      const sid = id("sess");
      await send({ ...view({ host: DEMO, sessionId: sid, path: "/dashboard" }), durationSec: 20 }, { ip: "190.50.5.5" }, new Date("2026-10-14T15:12:00Z"));
      await send({ ...view({ host: DEMO, sessionId: sid, path: "/eventos/demo_event_99", isEntry: false }), durationSec: 30 }, { ip: "190.50.5.5" }, new Date("2026-10-14T15:13:00Z"));
      await send({ ...view({ host: DEMO, sessionId: sid, path: "/finanzas", isEntry: false }), durationSec: 10 }, { ip: "190.50.5.5" }, new Date("2026-10-14T15:14:00Z"));
      const joined = await db.$queryRaw<Array<{ sessionId: string | null; modules: string[]; durationSec: number }>>`SELECT "sessionId","modules","durationSec" FROM "DemoSession" WHERE "sessionId" = ${sid}`;
      assert.equal(joined.length, 1);
      assert.deepEqual([...joined[0].modules].sort(), ["dashboard", "eventos", "finanzas"]);
      assert.equal(joined[0].durationSec, 14 * 60, "de las 15:00 a las 15:14");

      const range = traficoRange("hoy", new Date("2026-10-14T18:00:00Z"));
      const demo = await queries.getDemo(range);
      assert.equal(demo.started, 2);
      assert.equal(demo.measuredSessions, 1);
      assert.equal(demo.avgDurationSec, 840);
      assert.equal(demo.avgModulesPerSession, 3);
      assert.deepEqual(demo.topModules.map((m) => m.module).sort(), ["dashboard", "eventos", "finanzas"]);
      assert.equal(demo.topModules.find((m) => m.module === "eventos")!.sessions, 1);
      assert.equal(demo.conversion.available, false);
      assert.deepEqual(demo.startedByDay.map((d) => d.started), [2]);
      assert.equal(demo.startedDelta, "nuevo");
    });

    await t.test("la purga perezosa borra lo de más de 400 días y deja lo reciente", async () => {
      await reset();
      const now = new Date("2026-10-14T18:00:00Z");
      await send(view(), undefined, new Date("2025-06-01T12:00:00Z"));
      await send(view(), undefined, new Date("2026-10-01T12:00:00Z"));
      await metrics.purgeOldMetrics(now);
      assert.equal(await count(), 1);
    });
  } finally {
    await reset();
    await db.$disconnect();
  }
});
