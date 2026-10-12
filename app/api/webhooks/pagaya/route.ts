import { db } from "@/lib/server/db";
import { PagaYaRepository } from "@/lib/server/pagaya/repository";
import { receivePagaYaWebhook } from "@/lib/server/pagaya/inbox";
import { getPagaYaWebhookAdapter } from "@/lib/server/pagaya/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let adapter;
  try { adapter = getPagaYaWebhookAdapter(); }
  catch { return new Response("PagaYa webhook configuration or wire contract unavailable", { status: 503 }); }
  return receivePagaYaWebhook(request, new PagaYaRepository(db), adapter);
}
