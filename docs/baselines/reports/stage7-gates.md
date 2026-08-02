# Stage 7 gates

**Result:** PASS

- Comments fixture + memory migration idempotent (--twice)
- comment-policy disabled (prod) / enabled (staging); entry keys aligned
- Waline policy middleware unit tests
- Comments.astro lazy IntersectionObserver + readonly branch
- Compose waline / waline-staging scaffold (no host 8360 publish)

## Failures

(none)

## Deferred to VPS / Stage 9–10

- Live MySQL Waline schema apply + digest-pinned image
- Real POST 403/200 against production middleware
- Mail notification / Akismet live config
- Final stop-write reconciliation against production Typecho
