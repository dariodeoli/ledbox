# Pilot differential runner — #173 (#161/#123/#56/#119)

Runner: `scripts/pilot-differential.mjs`. Tests: `tests/pilot-differential.test.mjs`.
Independent tooling in `slot/pilot`; not a product release or generic Pilot approval.

## Modes

- `closure`: reads **existing local** integrator receipt references and verifies their bytes/hash bindings. Supports the actual HD76 cut, code checks, code terminal, failed outer terminal, same GET-only recovery, Hub deployment and five-host smoke structures. It returns `SERVED_CLOSURE_BOUND_NOT_PILOT_PASS`, preserving `QA_NOT_RUN_DEFERRED_OWNER`.
- `validate`: checks normalized differential intake (`manifest`, `checks`, `artifact`, `deployment` references, target SHA/version/application/deploy identity and five hosts), returns `INTAKE_BOUND_NOT_QA_PASS`.
- `anonymous`: only after current original-issuer DIRECT, readonly artifact custody and exact intake. Reuses `artifactSeal`/`sameArtifact`. GET `/api/health` and safe public surfaces only; fixed five origins, no cookie/auth, no redirects, no demo provisioning, no deployment operations. Checks actual served SHA/version and reports only anonymous identity scope. Authenticated seams remain `WAIT_INPUT`, excluded domains stay unexecuted.

```sh
node scripts/pilot-differential.mjs --mode closure --intake <receipt-reference-bundle.json> --sha <full40> --version 2.1.76
node scripts/pilot-differential.mjs --mode validate --intake <normalized-intake.json> --sha <full40> --version 2.1.76
node scripts/pilot-differential.mjs --mode anonymous --intake <normalized-intake.json> --sha <full40> --version 2.1.76 --lease <current-DIRECT.json> --artifact-root <authorized-readonly-copy> --output <own-receipt.json>
```

Closure bundle keys: `cut`, `served`, `checks`, `codeTerminal`, `outerTerminal`, `resume`, `hub`, `smoke`, `footer`, each `{path,sha256}`. Existing references are consumed, not regenerated. Code log bytes referenced by outer stages must match; a six-code PASS cannot erase failed outer deployment or fabricate SERVED without recovery proof.

Normalized manifest: `{sha,version,baseSHA,scopes,excludes}`. Scope filter accepts only `ops161`, `calendar56-119`, `auto173`; ancillary field123 is not issue closure. Explicit exclusions `fin143/services/mobile/ruc`. Checks require whole terminal PASS and nonzero exact-source terminal command/log results. Artifact binds SHA/version/manifestSHA256. Deployment requires terminal SERVED/FINISHED, matching deployID/applicationUUID and five unique fixed host identities with source-bound health refs.

DIRECT: `{issuerSession,kind:"DIRECT",granted:true,sha,action:"anonymous-identity",startsAt,startBy,expiresAt,maxDurationMs}`. Original issuer is `ses_ede13132fffeogzgUkyt86i744`. Usable current start window and explicit bounded budget required. No inherited Age/FIFO/queue reservation or grant inferred from SERVED. Artifact custody is an external input, not inferred by receipt ownership.

## Current target and execution hold

Latest owner-provided closure: **2.1.76**, release `58989b88af3d6072161261befa377507f23d0ca8`, tree `1dcb3eaa55e689235b948b4e9958b5d92ad24d0f`, deployment `rvrqkw2ppxvvv5ow4izhudhk`. Whole terminal `2d6f01…` failed postpush Hub count; same GET-only resume `0ab751…` resolved it to SERVED receipt `1f78f092…`. Code terminal `8cad85…` PASS and six actual code stages remain bounded to the release. Previous75/noSERVED is historical.

Existing receipt inputs consumed read-only; all nine owner-supplied SHA256 values matched actual local bytes (this is intake consumption, not executing the new validator or product QA):

| Bundle key | Existing path | SHA256 |
| --- | --- | --- |
| cut | `evidencia/ronda-al/HD-OPS-CALENDAR-CANDIDATE.json` | `99641df61218c882b3a6d97fd327678d43b691a4fc99b949eaaa2028df52ce71` |
| checks | `~/.config/ledbox/auto-hd-artifacts/58989b88af3d6072161261befa377507f23d0ca8/checks.json` | `2c5b4c4452e5d498aba46a846fcbc79639a3942595049259a8fbd8e048c4a2c1` |
| codeTerminal | same artifact directory, `TERMINAL-RELEASE.json` | `8cad85ba45bab8b19878e2cf2d5e3ec10dadd2ac09003924d6fedf9b590bd140` |
| outerTerminal | same artifact directory, `owned-terminal-release.json` | `2d6f01a13ce17b9d78c66eea811ac3072349a2c325efb51d542529ab59885d85` |
| resume | Secretaría `entregas/ledbox-hd58989-get-only-resume-result-20261010.json` | `0ab7513c277ce4ac0b938f56ee691f566348277c1a991e3a756bf2800c638af4` |
| served | Secretaría `entregas/ledbox-hd76-served-20261010.json` | `1f78f092741df996de78f6de8a3f7f07e4013b90cc941eba7aa2521ed1df0f19` |
| hub | same artifact directory, `hub-deployment.json` | `49437ed6a03d8d544ddfff04989977b6c8dbb60c8c54a2df6f5e3274b1be225c` |
| smoke | same artifact directory, `smoke.log` | `6d662c3981c2d5b2f4ee7a1e6485f8077d3f7aef75e167f484e923bfb68b3da9` |
| footer | Secretaría `entregas/ledbox-hd76-footer-public-smoke-20261010.json` | `c0942f6896cf92bce7f85e0a069ebaf1a41e0aafbe7667918641143d1ddb67cc` |

Resolve absolute paths in the external intake; the CLI does not expand `~`. No generated evidence replaces these receipts. Publication proof is acknowledged, independent QA is not inherited.

No new runtime QA, browser, PG, native renderer or production requests were dispatched in this implementation. Local test command prepared:

```sh
node --test tests/pilot-differential.test.mjs
```

Synthetic local files exercise wrong SHA/version, stale artifact, failed whole gates despite code PASS, evidence/log tamper, nonterminal/rollback/wrong deploy identity, incomplete/duplicate hosts, unsafe demo surface, out-of-scope/empty manifests, expired/wrong issuer DIRECT, and actual-shaped GET-recovery receipts. No copied accepted focal matrix or PANEL oracle.

Execution requires current compatible DIRECT before checks per active assignment. Until supplied, local tests/typecheck/build are **NOT_RUN_WAIT_DIRECT**, runtime anonymous QA **WAIT_INPUT_DIRECT_CUSTODY**, authenticated flows **QA_NOT_RUN_DEFERRED_OWNER / WAIT_INPUT_ACCESS**. FIN/PDF/services/mobile/RUC are excluded from this cut; FIN revalidation awaits its separate new composition and PF/PANEL review. No FIN fixtures on OPS/calendar runtime, no replay accepted units/HD75, no aggregate PASS.
