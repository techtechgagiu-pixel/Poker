ALTER TABLE player_stats ADD COLUMN friend_tables INTEGER DEFAULT 0;
INSERT OR IGNORE INTO achievements (key, tier, stat, threshold, mode) VALUES ('prietenii_la_joc', 'gold', 'friend_tables', 1, 'human');
