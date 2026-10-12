# LedBox source custody 2026-10-12

This is a source-only inventory, not product qualification. No original branches were deleted.

Recover all refs and objects on the owner's computer:

```sh
git clone --mirror https://github.com/dariodeoli/ledbox.git ledbox-recovery.git
git --git-dir=ledbox-recovery.git show recovery/complete-custody-20261012/manifest:MANIFEST.json
```

MANIFEST.json maps each original local ref and exact source SHA to a remotely recoverable ref.
For REACHABLE_ANCESTOR mappings the exact source SHA is contained in that remote history.
Verify any required source with `git --git-dir=ledbox-recovery.git cat-file -e <sourceSHA>`.
Create a new working clone from this mirror and check out the required SHA for source review.
Use codex/ledbox-gestion-multiempresa as the production baseline, never historical main.
Recovery histories, mobile/PDF/PagaYa/S1/OPS/Pilot artifacts do not imply qualification or admission.
OPS remains retired. Build caches/dependencies are rebuildable; no secret or environment file is included.
Deletion is a separate owner action after the final clean-state and source-custody receipt is consumed.
