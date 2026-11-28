-- 28 Nov: "Most popular" ranks by people with the product on a list, then by how often it was opened from search
-- results (last 30 days), then by discount. Opens from search are counted per product per day here.
ALTER TABLE product_views ADD COLUMN search_opens INTEGER NOT NULL DEFAULT 0;
