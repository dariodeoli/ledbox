# EventOS MCP tool contract

This catalog is the server-side source of truth for tool names, input schemas,
field allowlists, and role gates: `lib/server/mcp-catalog.ts`. The HTTP adapter
must resolve the bearer token to an active membership first and then construct
`McpActorContext` from that membership. Never accept `organizationId`, role,
actor identity, or an active-company selector from MCP arguments.

## Tools

| Tool | Access | Roles | Effect |
| --- | --- | --- | --- |
| `company.read`, `catalog.read`, `inventory.read`, `clients.read`, `leads.read`, `budgets.read`, `events.read` | Read | All five roles | Tenant-scoped read; response fields are allowlisted. |
| `treasury.read`, `payments.read`, `reports.read` | Read | OWNER, ADMIN, FINANCE | Bank accounts, client payments and aggregate cash/commercial reports. No supplier costs or secrets. |
| `prices.preview` / `prices.confirm` | Two-step write | OWNER, ADMIN, FINANCE | Preview exact change, then confirm once. |
| `quantities.preview` / `quantities.confirm` | Two-step write | OWNER, ADMIN, OPERATIONS | Preview exact change, then confirm once. |
| `company.preview` / `company.confirm` | Two-step write | OWNER, ADMIN | Preview public profile changes, then confirm once. |
| `photos.preview` / `photos.confirm` | Two-step write | OWNER, ADMIN, OPERATIONS | Validate image metadata, then store via existing tenant-scoped storage. |
| `budgets.preview` / `budgets.confirm` | Two-step write | OWNER, ADMIN, FINANCE | Review a PYG draft for an existing tenant client and optional inventory items, then create draft only. |
| `budgets.edit.preview` / `budgets.edit.confirm` | Two-step write | OWNER, ADMIN, FINANCE | Edit title, validity and payment plan on a DRAFT only; payment conditions may reference active PYG treasury accounts in the same company. |
| `budgets.compare.preview` / `budgets.compare.confirm` | Two-step write | OWNER, ADMIN, FINANCE | Create a public 2–5 option comparison from eligible budgets of one client after a current-state preview. |

`VIEWER` is read-only. No tool exposes internal purchase costs, margins,
supplier records, or supplier banking details. Budget reads expose customer
prices only. A write preview must be persisted server-side, scoped to actor and
organization, expire, and include a digest of normalized input. Confirmation
must load that preview, recheck membership/role and resource ownership, compare
the digest, and atomically record the idempotency key with the write. Replaying
the same key returns the original result; reusing it with a different payload
is a conflict. Confirmation never means “send”: budget confirmation only
creates a draft and captures the reviewed commercial line prices. It does not
change lead/client status, send, approve, sign, reserve stock, create payment
plan entries, or record payment. The one-hour preview becomes stale if its
selected client or inventory product changes before confirmation.

## Adapter requirements

- Call `authorizeMcpTool` on every request, including confirmation. Do not rely
  on the tool list exposed during initialization as authorization.
- Parse arguments using `parseMcpToolInput`; schemas are strict and do not
  accept tenant IDs or unexpected properties.
- Every database query and mutation must include the context's organization ID
  in the database predicate. Resolve parent-child ownership before mutation.
- Project read responses through each tool's `outputFields` allowlist. Never
  serialize ORM rows directly.
- The photo adapter must verify actual bytes (not only declared MIME/name),
  enforce size limits, and use existing image storage.
- Add rate limits, audit actor/tool/resource/outcome, and cap result sizes at
  the adapter boundary. Errors must not reveal whether another tenant's ID
  exists.

This file defines the reusable catalog and policy contract; it does not claim
OAuth discovery or a deployed `/mcp` transport exists.
