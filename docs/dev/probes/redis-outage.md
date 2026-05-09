# Redis-outage probe

Confirms the rate limiter fails closed when Upstash is unreachable. The contract: if the limiter can't reach Redis (or gets a malformed response), every rate-limit check returns `503 rate_limit_unavailable`. We never silently admit traffic.

## Why this matters

A fail-open rate limiter under outage is a near-perfect attack surface — write-heavy bots can bypass per-bot caps for the duration of the incident. The `lib/rate-limit.ts` design has four failure modes (broken host, timeout, SDK exception, malformed response), all of which must surface as 503.

## Automated coverage

`tests/rate-limit/upstash-shape.test.ts` covers the malformed-response branch via `coerceUpstashResult`. The other three are partially exercised by the outer `try`/`catch` in `checkPixelWriteRateLimit` but not unit-tested per-branch — that's a known gap (M1 review T2).

## Manual probe (prod or staging)

The reliable path is to point the deployment at a non-existent Upstash endpoint and confirm the 503.

```bash
# Set a bad Upstash URL on a non-prod environment.
vercel env add UPSTASH_REDIS_REST_URL preview '' \
  --value 'https://nonexistent.upstash.io'
# Trigger a redeploy, then:
curl -fsSi -X POST 'https://<preview-url>/api/v1/pixels' \
  -H 'Authorization: Bearer <bot-key>' \
  -H 'Content-Type: application/json' \
  -d '{"sector_id":"sector-1","x":0,"y":0,"color":0}'
```

## Expected outcome

```
HTTP/2 503
content-type: application/json
{ "error": "rate_limit_unavailable", "request_id": "<uuid>" }
```

The structured server log line should include `error_slug: "rate_limit_unavailable"` and `dependency: "upstash"`.

## What a failure means

If you see `200`, the limiter fell open — investigate the `try`/`catch` blocks in `checkPixelWriteRateLimit` and `checkReadRateLimit`. Every Upstash call must be wrapped, and any throw must surface as `rate_limit_unavailable` not silent success.

If you see `429` with `X-RateLimit-Remaining-*` headers, the in-process memory fallback engaged — that's the dev fallback, never expected in prod. Double-check `NODE_ENV === "production"` and that the env vars are wired (`UPSTASH_REDIS_REST_URL` + `_TOKEN`, or `KV_REST_API_URL` + `_TOKEN`).

## Cleanup

Restore the original Upstash URL and redeploy.

```bash
vercel env rm UPSTASH_REDIS_REST_URL preview
vercel env add UPSTASH_REDIS_REST_URL preview '' --value '<real-url>'
```
