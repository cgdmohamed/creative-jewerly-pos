BEGIN;

INSERT INTO app_settings (key, value) VALUES
  ('label_template','basic'),
  ('label_logo_enabled','true'),
  ('label_brand_name','GOLDEN CROWN'),
  ('label_printer_name','LV-1300'),
  ('label_offset_x_mm','0'),
  ('label_offset_y_mm','0')
ON CONFLICT (key) DO NOTHING;

COMMIT;
