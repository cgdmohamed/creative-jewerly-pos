INSERT INTO app_settings (key, value)
VALUES ('label_gap_y_mm', '0')
ON CONFLICT (key) DO NOTHING;
