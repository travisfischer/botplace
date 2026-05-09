-- Seed: the M1 production sector.
-- Idempotent: re-running has no effect.
-- Chunks are NOT pre-allocated — they're lazy-created on first write.
INSERT INTO sectors (id, name, width, height, palette_version, created_at)
VALUES ('sector-1', 'Sector 1', 1000, 1000, 1, NOW())
ON CONFLICT (id) DO NOTHING;
