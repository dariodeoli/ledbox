# PagaYa public connector contract fixtures — #182

`pagaya-server.mjs` is an unmodified UTF-8 snapshot of the public copy-source
connector, **test fixture only**, not a second product connector. Public guide
and connector were read through webfetch; the HTTP200 text response from the
Code Mode fetch also supplied the connector source. Its local immutable byte
pin is in `snapshot.json`, separately asserted in the tests. No upstream Git SHA
was supplied; `sourceSHA256` means the public source byte digest, not an invented
upstream commit. Do not update this snapshot or its pin to hide a contract failure.

`contracts.json` contains synthetic UUIDs, priceVersionId, customer and command
identity only. No price amounts, approved plans, keys, Connect configuration,
live operations or delivery claims are supplied. Test API keys/HMAC secrets are
obvious local fixture strings. Tests inject local fetch and never call a provider.

Run from repo root:

```sh
node --test tests/pagaya-server-contract.test.mjs
```

## Actual FIN copy — explicit dependency

No guessed repository path is discovered. Until the FIN owner closes and supplies
its source, the actual-copy qualification is **NOT_RUN**, independently from
public-snapshot tests. The same suite can consume the copy via the explicitly
supplied local `PAGAYA_FIN_SOURCE_RECEIPT` JSON path, with:

- `repository`: actual closed owner repository path;
- `sourceSHA`, `sourceTree`: exact 40-hex commit/tree;
- `connectorPath`: relative path of the copied connector in that source;
- `connectorSHA256`: exact copied bytes;
- `officialSourceSHA256`: expected public pin from snapshot.json.

The test verifies the commit/tree/blob through read-only local Git commands and
compares worktree bytes with the closed Git blob before importing that actual
copy and running the same offline contracts. Missing receipt means an explicit
skipped/NOT_RUN dependency; a supplied malformed or mismatched receipt fails.
The connector must match the official snapshot exactly; modified adapters need
their own qualified source and cannot silently inherit this contract result.

## Consumer repository obligations — NOT_RUN until actual owner source exists

This connector does not enforce local ownership, durably deduplicate event IDs,
store immutable commands, validate app/mode/customer correlation or implement
period-based access. It forwards API calls and verifies signatures. Fresh replay
signatures are valid, not proof of duplicate suppression. Permissions are enforced
by PagaYa; simulated 403 propagation does not demonstrate live app-key scopes.
202 renewal response remains pending, not applied. Portal sends an empty body and
does not accept overrides. Consumer ownership/inbox/command repository behavior,
actual test-mode/Connect setup, webhook worker delivery and live flows remain
separate NOT_RUN dependencies. No product PASS/100, provider or delivery proof.
