BEGIN;

ALTER TABLE items DROP CONSTRAINT IF EXISTS items_craftsmanship_type_check;
ALTER TABLE items ADD CONSTRAINT items_craftsmanship_type_check
  CHECK (craftsmanship_type IN ('fixed','percent','per_gram'));

ALTER TABLE items ADD COLUMN IF NOT EXISTS craftsmanship_profile TEXT;

UPDATE items i
   SET craftsmanship_profile = CASE
     WHEN lower(COALESCE(c.code, '')) ~ '(bullion|bar|ingot)'
       OR COALESCE(c.name_ar, '') ~ '(سبائك|سبيكة)' THEN 'bullion'
     WHEN i.physical_status = 'used' THEN 'used_jewelry'
     ELSE 'new_jewelry'
   END
  FROM categories c
 WHERE i.category_id = c.id AND i.craftsmanship_profile IS NULL;

UPDATE items
   SET craftsmanship_profile = CASE WHEN physical_status = 'used' THEN 'used_jewelry' ELSE 'new_jewelry' END
 WHERE craftsmanship_profile IS NULL;

ALTER TABLE items ALTER COLUMN craftsmanship_profile SET DEFAULT 'new_jewelry';
ALTER TABLE items ALTER COLUMN craftsmanship_profile SET NOT NULL;
ALTER TABLE items DROP CONSTRAINT IF EXISTS items_craftsmanship_profile_check;
ALTER TABLE items ADD CONSTRAINT items_craftsmanship_profile_check
  CHECK (craftsmanship_profile IN ('new_jewelry','used_jewelry','bullion','custom'));

INSERT INTO app_settings (key, value) VALUES
  ('workmanship_new_type','per_gram'),
  ('workmanship_new_value','0'),
  ('workmanship_used_type','per_gram'),
  ('workmanship_used_value','0'),
  ('workmanship_bullion_type','per_gram'),
  ('workmanship_bullion_value','0')
ON CONFLICT (key) DO NOTHING;

COMMIT;
