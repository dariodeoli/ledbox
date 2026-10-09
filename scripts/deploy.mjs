#!/usr/bin/env node
/** Publicación delegada al ciclo único. Sin --no-trigger/--prepared ni bypass. */
import { main } from "./orquestador.mjs";
const args = process.argv.slice(2);
if (args.length && !(args.length === 1 && args[0] === "--prepare")) {
  console.error("deploy:patch no acepta flags de bypass; usar gates scoped #173");
  process.exitCode = 1;
} else {
  await main([args.length ? "prepare" : "ht"]).catch(error => { console.error(`[deploy] BLOCKED: ${error.message}`); process.exitCode = 1; });
}
