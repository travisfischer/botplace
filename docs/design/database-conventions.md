# Database conventions

Naming and organization rules for Prisma schemas, Postgres tables, and migrations in Botplace. Follow these whenever you add or modify a model. The rules are mechanical — every reviewer (human or agent) should be able to check them at a glance.

The *discipline* layer (schema-first seriousness, written design rationale, human-mandatory review) is enforced by the sacred-schema review principle that runs against every requirement and PR. Both apply.

## Naming

- **Postgres identifiers are `lower_snake_case`.** Tables, columns, constraints. No quoted mixed-case identifiers.
- **Prisma client identifiers are PascalCase / camelCase.** Models singular `PascalCase`; fields `camelCase`.
- **Bridge with `@map` / `@@map`.** Every multi-word Prisma field that doesn't already match snake_case gets `@map("snake_case_name")`. Every model gets `@@map("plural_snake_case_table")`.
- **Tables are plural snake_case.** `owners`, `bots`, `bot_api_keys`, `pixel_events`. Models stay singular: `Owner`, `Bot`, `BotApiKey`, `PixelEvent`.
- **Foreign-key columns use `<referenced_entity_singular>_id`.** `owner_id`, `bot_id`, `sector_id`. The Prisma scalar is the `camelCase` equivalent (`ownerId`).
- **Lifecycle fields are `created_at` / `updated_at` / `deleted_at`** (last only when soft delete is in scope).
- **Booleans read as booleans.** `is_active`, `has_access`. A nullable timestamp (`revoked_at`) often beats a boolean — it captures presence and timing in one column.
- **Enums.** Status-like enums use `SCREAMING_CASE` values (`ACTIVE`, `REVOKED`). Domain-vocabulary enums match the domain's casing.
- **Timestamp clarity.** Add a `Utc` suffix to fields whose timezone could be ambiguous (e.g., timestamps synced from a third-party system). Pure server-side timestamps don't need it — Prisma + Postgres use `timestamptz` by default.

## Field organization within a model

Top-to-bottom:

1. Primary key (`id`)
2. Foreign-key scalars — paired with their relation field directly below
3. External-source fields (when mirroring a third-party system — see pattern below)
4. Domain fields
5. Lifecycle fields (`created_at`, `updated_at`, `deleted_at?`)
6. Reverse relations (lists)
7. `@@` block (`@@id`, `@@unique`, `@@index`, `@@map`)

Goal: "what is this row?" should be answerable from the top half of the model.

## Cascade policy

Default is **`Restrict`** on edges that touch audit, event-log, or otherwise-irreplaceable lineage. Use `Cascade` only when the dependent rows are pure derived state — e.g., chunk blobs of a deleted sector, where the source of truth is the event log.

The reasoning question: "is the dependent row recoverable from elsewhere?" If yes, cascade. If no, restrict.

`SetNull` is reserved for FK columns that are intentionally nullable and have a documented "ownership transfer" semantic.

## Indexes

- **Composite indexes lead with the scoping FK** + a sort/filter dimension. Example: `@@index([sectorId, createdAt])` for time-window queries scoped to one sector.
- **Add a deterministic-ordering index** for any table that needs replay: `@@index([scope_id, id])`.
- **`@unique` on hashes that authenticate** is a security invariant, not a performance hint. Comment it as such.
- **No speculative indexes.** Each `@@index` should name the access pattern it serves in a comment if it isn't obvious from the columns.

## Composite uniqueness

Use `@@unique([scope_id, natural_key])` for natural-key uniqueness within a scope. Example: `@@unique([ownerId, name])` — bot names are unique per owner, not globally.

## Comments

- **Above enums:** explain the intent (especially when normalizing external values).
- **Beside fields whose purpose isn't obvious from the name:** PII fields, fields copied from another row at write time, fields whose value shape isn't expressible in the type (e.g., `prefix` = "first 8 chars of plaintext for log display").
- **Skip comments that restate the name.** "the user's email" on a column named `email` is noise.

## External-source pattern (future)

When a row mirrors data from a third-party system, use this cluster:

- `source` (enum identifying the external system)
- `source_connection_id` (which connection of that system)
- `source_<entity>_id` (id in the external system)
- `source_created_at` / `source_updated_at` (their timestamps)
- `synced_at` (when we last fetched it)
- `source_data Json? @default("{}")` (raw payload for forensics)

Not used today; pull this in when the first external integration lands.

## Versioned-content pattern (future)

When content needs full version history with a single "currently active" pointer, use the three-table pattern:

- `Foo` (master record, immutable identity)
- `FooVersion` (one row per version, immutable content)
- `FooActiveVersion` (single row pointing at the currently-active version)

Not used today (`palette_version: Int` on `Sector` is enough). Reach for this when content needs auditable revision history.

## Migrations

- Apply via `pnpm db:migrate:deploy`; never out-of-band SQL.
- Forward-only in production. Recovery uses Neon point-in-time + the application-layer kill-switches that own the data.
- Backfills must be idempotent and resumable.
- Validate destructive migrations on a Neon dev branch first.

## Generator + datasource

- One `schema.prisma` file. Domain grouping happens via model-name prefixes.
- Generated client output: `generated/prisma/` (gitignored). Imported as `@/generated/prisma/client`.
