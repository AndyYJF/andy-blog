# Stage 8 gates

**Result:** PASS (automated blockers)

- Public CIDs with review records: 15
- Human Final (reviewKind=human): 13
- Agent spot (reviewKind=agent-spot): 2
- Audit sync (reviewKind=audit): 0
- Audit: pass=5 warn=10 block=0
- Classification uses explicit `reviewKind` only (reviewer name is display metadata)
- Content hashes required on every review (sourceSha256)
- Heading skips & body h1s: accepted warnings (A11y at Stage 9 Lighthouse)

## Warnings

- 2/15 reviews are agent-spot (not human Final)
- Stage 8 Final incomplete: human pass 13/15

## Failures

(none)
