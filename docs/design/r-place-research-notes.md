# Deep Research Notes: How Reddit’s r/place Was Built (2017 & 2022)  
*(System design + infrastructure patterns you can reuse)*

> Scope note: This summarizes **publicly described** details (official engineering posts, talks, and the 2017 open-source release). Reddit’s internal cluster sizing, private runbooks, and some operational details are not public, so there are inevitable gaps.

---

## Table of contents
- [What problem r/place solves](#what-problem-rplace-solves)
- [2017 architecture (original)](#2017-architecture-original)
  - [Canvas storage: bit-packed pixels in Redis](#canvas-storage-bit-packed-pixels-in-redis)
  - [Read path: ship the whole board (CDN caching)](#read-path-ship-the-whole-board-cdn-caching)
  - [Real-time updates: WebSockets for deltas](#real-time-updates-websockets-for-deltas)
  - [Metadata/history storage](#metadatahistory-storage)
  - [Open source code](#open-source-code)
- [2022 architecture (remaster)](#2022-architecture-remaster)
  - [Shard into quadrants](#shard-into-quadrants)
  - [Distribute updates as images (full + diff frames)](#distribute-updates-as-images-full--diff-frames)
  - [Loss handling: timestamp chaining + resubscribe](#loss-handling-timestamp-chaining--resubscribe)
  - [Storage/CDN scale (MediaStore)](#storagecdn-scale-mediastore)
  - [WebSocket fanout limits + mitigations](#websocket-fanout-limits--mitigations)
  - [Backend realtime service + Redis bit packing](#backend-realtime-service--redis-bit-packing)
  - [Canvas history viewer (timestamp → image URLs)](#canvas-history-viewer-timestamp--image-urls)
- [Supporting systems](#supporting-systems)
  - [Mobile via WebView](#mobile-via-webview)
  - [Sharing (deep links + Open Graph + app handoff)](#sharing-deep-links--open-graph--app-handoff)
  - [Notifications & email](#notifications--email)
  - [Bots & safety + admin tooling](#bots--safety--admin-tooling)
- [Two architectural patterns to steal](#two-architectural-patterns-to-steal)
- [Blueprint: How to design a similar system](#blueprint-how-to-design-a-similar-system)
- [Curated reading list (best public resources)](#curated-reading-list-best-public-resources)

---

## What problem r/place solves

r/place looks simple (“set a pixel every N minutes”), but the system is dominated by:

- **Massive read amplification**: huge numbers of viewers need canvas state.
- **Real-time-ish updates**: it needs to *feel live*.
- **Write fairness**: cooldown / rate limiting is part of the game.
- **High fanout**: accepted writes must be visible to many connected clients.
- **Abuse & moderation**: bots, multi-accounting, takedowns.
- **Operational knobs**: tune cooldowns, batch sizes, and degrade gracefully under load.

---

## 2017 architecture (original)

### Canvas storage: bit-packed pixels in Redis

- 2017 canvas: **1000×1000 = 1,000,000 pixels**.
- Stored as a tightly packed blob where each pixel is a **4-bit unsigned int** (16 colors), so the whole board is about **~500 KB** (before compression).
- Redis **BITFIELD** was used to update multi-bit pixels (cleaner than SETBIT loops).

**Why it’s smart:** storing the entire board in RAM as a compact array makes “read the board” cheap, and enables caching the full board as a single object.

Sources:
- Reddit (2017): <https://redditinc.com/news/how-we-built-rplace>
- Fastly talk summary: <https://www.fastly.com/blog/reddit-on-building-scaling-rplace>

---

### Read path: ship the whole board (CDN caching)

2017 leaned into a blunt but effective strategy:

- Serve the whole board as a cached asset.
- Use CDN edge caching with a very low TTL (reported around **~1 second**) to keep it “fresh enough” while offloading origin.
- Also used internal caching tiers (Fastly summary mentions server-side caching layers like memcache, then Redis).

Sources:
- Fastly talk summary: <https://www.fastly.com/blog/reddit-on-building-scaling-rplace>

---

### Real-time updates: WebSockets for deltas

- Since CDN snapshot refresh is slightly stale, **WebSockets** push pixel updates so users see changes quickly.
- Clients typically fetch the snapshot then apply deltas.

Sources:
- Fastly talk summary: <https://www.fastly.com/blog/reddit-on-building-scaling-rplace>

---

### Metadata/history storage

Public writeups indicate an additional datastore was used for metadata / history:

- **Cassandra** was mentioned in 2017-related material as a store for additional data (e.g., attribution/history), while Redis held the primary packed canvas.

Sources:
- Reddit (2017): <https://redditinc.com/news/how-we-built-rplace>
- 2017 open source README references Cassandra backups: <https://github.com/reddit/reddit-plugin-place-opensource>

---

### Open source code

Reddit released the 2017 implementation as open source (plugin). It references:

- Redis usage
- Cassandra restore steps / backups

Source:
- GitHub: <https://github.com/reddit/reddit-plugin-place-opensource>

---

## 2022 architecture (remaster)

Reddit explicitly said much of the 2017 design wouldn’t hold at 2022 scale.

The biggest shift: **don’t push per-pixel updates to everyone.**  
Instead, distribute canvas updates as **images** (full frames + diff frames) and push only **URLs** over real-time channels.

Source:
- Backend Part 1 (2022): <https://www.reddit.com/r/RedditEng/comments/vwv2fl/how_we_built_rplace_2022_backend_part_1_backend/>

---

### Shard into quadrants

2022 modeled the canvas as multiple “quadrants”:

- Each quadrant is **1000×1000**.
- Total canvas could expand (up to multiple quadrants).
- Clients subscribe to a **config channel** to learn:
  - quadrant size
  - quadrant IDs and coordinates
- When the canvas expands, backend pushes new config; clients resubscribe.

Source:
- Web Canvas Part 1: <https://www.reddit.com/r/RedditEng/comments/vhh962/how_we_built_rplace_2022_web_canvas_part_1/>

---

### Distribute updates as images (full + diff frames)

For each quadrant channel:

1) On subscribe, server sends a URL for the **current full PNG**.  
2) Then server streams URLs for **diff PNGs** (transparent background; only changed pixels).  
3) Client uses `drawImage()` to paint onto an HTML `<canvas>`.

**This converts a realtime fanout problem into a CDN content distribution problem.**

Source:
- Web Canvas Part 1: <https://www.reddit.com/r/RedditEng/comments/vhh962/how_we_built_rplace_2022_web_canvas_part_1/>

---

### Loss handling: timestamp chaining + resubscribe

WebSockets preserve order but not guaranteed delivery. The 2022 client uses timestamps:

- Each diff frame comes with timestamps for “previous” and “current.”
- If the chain breaks (gap), client resubscribes to obtain a fresh full frame baseline.

Source:
- Web Canvas Part 1: <https://www.reddit.com/r/RedditEng/comments/vhh962/how_we_built_rplace_2022_web_canvas_part_1/>

---

### Storage/CDN scale (MediaStore)

In 2022 scale writeup:

- Millions of full and diff PNGs were served from **AWS Elemental MediaStore**.
- Cache hit ratio was extremely high (the whole approach relies on CDN success).

Source:
- Backend Scale: <https://www.reddit.com/r/RedditEng/comments/w4jpxl/how_we_built_rplace_2022_backend_scale/>

---

### WebSocket fanout limits + mitigations

Reddit describes both load test and production issues:

- Load testing up to **10 million clients** exposed issues like **ephemeral port exhaustion** (on Linux clients generating load).
- In production, slow socket writes inflated latency.
- Mitigations included:
  - slowing frame generation (e.g., to ~200ms)
  - per-client buffers so slow consumers don’t harm fast ones

Source:
- Backend Scale: <https://www.reddit.com/r/RedditEng/comments/w4jpxl/how_we_built_rplace_2022_backend_scale/>

---

### Backend realtime service + Redis bit packing

Public description includes:

- Continued use of packed pixels in Redis; now **5 bits per pixel** (more colors).
- Dedicated “Realtime service” in Go; GraphQL subscriptions were part of the delivery approach.

Source:
- Backend Part 1: <https://www.reddit.com/r/RedditEng/comments/vwv2fl/how_we_built_rplace_2022_backend_part_1_backend/>

---

### Canvas history viewer (timestamp → image URLs)

Instead of generating a monolithic video:

- UI has a slider (timestamp).
- Client posts timestamp to a GraphQL server.
- Requests are throttled (e.g., ~100ms).
- Server returns **cached image URLs** (1–4, one per quadrant).
- Backend stores timestamp→URL pairs in **1-second buckets** for O(1) retrieval.

Source:
- Canvas History Viewer: <https://www.reddit.com/r/RedditEng/comments/wxk0f5/canvas_history_viewer/>

---

## Supporting systems

### Mobile via WebView

- Reddit embedded the experience in a **WebView**, reusing web canvas code on mobile.
- This also allows shipping changes without waiting for app store updates.

Source:
- Mobile clients: <https://www.reddit.com/r/RedditEng/comments/waex8z/how_we_built_rplace_2022_mobile_clients/>

---

### Sharing (deep links + Open Graph + app handoff)

- Share links include coordinates (deep link to location).
- Open Graph image previews.
- Used native share sheets for UX, with WebView↔native image handoff via base64/data URL conversion.

Source:
- Share: <https://www.reddit.com/r/RedditEng/comments/wlu1ub/how_we_built_rplace_2022_share/>

---

### Notifications & email

- Used banners and nav icons for entry.
- Used push notifications and emails at very large scale to drive participation.

Source:
- Notifications/email: <https://www.reddit.com/r/RedditEng/comments/wdki9k/how_we_build_rplace_push_notifications_and_emails/>

---

### Bots & safety + admin tooling

Publicly described defenses and tools include:

- Detecting “low entropy registration clusters” and blocking their pixel placements.
- Restricting mass multi-account usage.
- Admin tools:
  - place without cooldown
  - draw rectangles
  - identify coordinated actions in region/time windows; restrict those users

Source:
- Bots & Safety: <https://www.reddit.com/r/RedditEng/comments/wro64p/how_we_built_rplace_2022_bots_and_safety/>

---

## Two architectural patterns to steal

### Pattern A — Snapshot + pixel deltas (2017-style)
**Best when:** canvas is modest; you can afford pushing deltas.

- Packed canvas state in Redis
- Canvas snapshot served via CDN with low TTL (≈1s)
- WebSocket streams pixel updates
- Clients apply deltas

Primary references:
- 2017 writeup: <https://redditinc.com/news/how-we-built-rplace>
- Fastly summary: <https://www.fastly.com/blog/reddit-on-building-scaling-rplace>

---

### Pattern B — Snapshot + image diffs via CDN (2022-style)
**Best when:** audience is enormous; realtime channel must be cheap.

- Canvas is sharded into quadrants
- Realtime channel streams **URLs** to full frames + diff frames
- CDN/object storage does the heavy lifting
- Timestamp chaining to detect loss and resubscribe

Primary references:
- Web Canvas Part 1: <https://www.reddit.com/r/RedditEng/comments/vhh962/how_we_built_rplace_2022_web_canvas_part_1/>
- Backend Scale: <https://www.reddit.com/r/RedditEng/comments/w4jpxl/how_we_built_rplace_2022_backend_scale/>

---

## Blueprint: How to design a similar system

Below is a practical architecture you can implement in stages, starting simpler and evolving toward 2022-style.

### 1) Data model

**Canvas state (hot):**
- bit-packed array (4–6 bits per pixel)
- Redis BITFIELD is convenient, but custom in-memory shards can also work

**Event log (durable):**
- append-only stream of placements: `(ts, user_id, x, y, color, client_meta)`
- used for replay, audit, and building history snapshots

**Separation principle:** keep “current state” hot and compact, and keep “history” durable and queryable.

---

### 2) Write path (“place pixel”)

1. Authenticate user
2. Validate coordinates + color
3. Enforce cooldown / rate limits
4. Atomic update to canvas state
5. Append placement to event log
6. Publish update to realtime pipeline

---

### 3) Read path (current canvas)

**MVP / 2017-like**
- Serve whole canvas snapshot via CDN (very low TTL)
- Clients use WebSocket for pixel deltas

**Scaled / 2022-like**
- Serve full PNG per region (quadrant) via CDN/object store
- Stream diff PNG URLs over WebSocket

---

### 4) Realtime distribution options

- **Option 1:** broadcast pixel events per region (simple)
- **Option 2:** broadcast diff-frame URLs + timestamp chaining (scales much better)

The key is that URLs let you:
- keep WebSocket payloads tiny
- offload transfer to CDN
- batch many placements into one diff frame

---

### 5) Region sharding early

Even if you only run 1000×1000 at launch, implement region sharding early:

- reduces blast radius
- supports future expansions
- limits “hot region” fanout impact

---

### 6) History mode (optional but high-value)

- Slider scrubber → timestamp queries
- Backend returns nearest cached snapshot URLs
- Store timestamp→URL mappings in buckets (e.g., 1-second) for fast lookup
- Throttle client queries to prevent overload

---

### 7) Abuse resistance (minimum set)

- account age / reputation gating
- rate limits + cooldown tiers
- anomaly detection: suspicious registration clusters or coordinated bursts
- admin tools: region masking, bulk repaint, user restrictions

---

### 8) Operational knobs (critical)

Build config toggles from day one:

- adjust cooldown dynamically
- slow down frame generation rate under load
- degrade “nice-to-have” features first (history, attribution)
- circuit-breakers around expensive calls

---

## Curated reading list (best public resources)

### Best starting sequence
1) 2017: How we built r/place  
<https://redditinc.com/news/how-we-built-rplace>

2) 2017: Open source plugin  
<https://github.com/reddit/reddit-plugin-place-opensource>

3) 2022: Conclusion hub (links the full series)  
<https://www.reddit.com/r/RedditEng/comments/x97j2q/how_we_built_rplace_2022_conclusion/>

4) 2022: Backend Part 1  
<https://www.reddit.com/r/RedditEng/comments/vwv2fl/how_we_built_rplace_2022_backend_part_1_backend/>

5) 2022: Backend Scale  
<https://www.reddit.com/r/RedditEng/comments/w4jpxl/how_we_built_rplace_2022_backend_scale/>

6) 2022: Web Canvas Part 1  
<https://www.reddit.com/r/RedditEng/comments/vhh962/how_we_built_rplace_2022_web_canvas_part_1/>

7) 2022: Canvas History Viewer  
<https://www.reddit.com/r/RedditEng/comments/wxk0f5/canvas_history_viewer/>

### Bonus references
- Fastly blog (talk summary): <https://www.fastly.com/blog/reddit-on-building-scaling-rplace>  
- YouTube overview: <https://www.youtube.com/watch?v=HzD132EchVo>

---

## Appendix: mental model diagram

```text
                 ┌──────────────────────────────────────────┐
                 │                Clients                    │
                 │   - fetch full PNG snapshots              │
                 │   - fetch diff PNGs                       │
                 │   - draw onto HTML canvas                 │
                 └───────────────┬──────────────────────────┘
                                 │ WebSocket (tiny messages)
                                 ▼
                      ┌─────────────────────┐
                      │ Realtime Fanout     │
                      │ - per quadrant chans│
                      │ - sends URLs + ts   │
                      └──────────┬──────────┘
                                 │ publish
                                 ▼
┌───────────────────────┐  ┌───────────────────────┐  ┌──────────────────────┐
│ Place API / Auth       │  │ Frame Builder         │  │ Abuse / Admin Tools  │
│ - cooldowns, rate limit│  │ - batches updates     │  │ - restrict, repaint  │
│ - validate writes      │  │ - emits PNGs to CDN   │  └──────────────────────┘
└──────────┬────────────┘  └──────────┬────────────┘
           │ update                     │ upload
           ▼                            ▼
   ┌──────────────┐            ┌───────────────────┐
   │ Canvas State  │            │ Object Store/CDN  │
   │ - packed bits │            │ - full frames     │
   │ - Redis-like  │            │ - diff frames     │
   └──────────────┘            └───────────────────┘
           │ append
           ▼
   ┌──────────────────┐
   │ Event Log         │
   │ - audit/replay    │
   │ - history indexes │
   └──────────────────┘
```

---

*End of notes.*
