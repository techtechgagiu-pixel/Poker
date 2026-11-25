-- Gagiu's WorkArt Remi — D1 schema
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, nickname TEXT NOT NULL,
  avatar TEXT, lang TEXT DEFAULT 'ro', prefs_json TEXT DEFAULT '{}', privacy_json TEXT DEFAULT '{}',
  recovery_hash TEXT NOT NULL, created_at INTEGER NOT NULL, suspended INTEGER DEFAULT 0, last_seen INTEGER, presence TEXT DEFAULT 'offline'
);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS guests (guest_hash TEXT PRIMARY KEY, user_id TEXT, created_at INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS player_stats (
  player_key TEXT NOT NULL, mode TEXT NOT NULL,
  matches INTEGER DEFAULT 0, wins INTEGER DEFAULT 0, losses INTEGER DEFAULT 0, rounds_won INTEGER DEFAULT 0,
  normal_joker INTEGER DEFAULT 0, normal_plain INTEGER DEFAULT 0, sequences INTEGER DEFAULT 0, triples INTEGER DEFAULT 0,
  doubles INTEGER DEFAULT 0, color INTEGER DEFAULT 0, grand INTEGER DEFAULT 0, joker_closes INTEGER DEFAULT 0,
  pass_activations INTEGER DEFAULT 0, atu_declarations INTEGER DEFAULT 0, current_streak INTEGER DEFAULT 0, best_streak INTEGER DEFAULT 0,
  hosted INTEGER DEFAULT 0, full_tables INTEGER DEFAULT 0, tournaments_won INTEGER DEFAULT 0,
  PRIMARY KEY (player_key, mode)
);

CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY, room_code TEXT NOT NULL, match_no INTEGER NOT NULL, mode TEXT NOT NULL,
  started_at INTEGER NOT NULL, finished_at INTEGER NOT NULL, rounds INTEGER NOT NULL,
  winner_key TEXT, winner_name TEXT, config_json TEXT NOT NULL, humans INTEGER NOT NULL, tournament_id TEXT, tournament_match_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_matches_finished ON matches(finished_at);
CREATE TABLE IF NOT EXISTS match_players (
  match_id TEXT NOT NULL, seat INTEGER NOT NULL, player_key TEXT, name TEXT NOT NULL, is_bot INTEGER NOT NULL,
  final_score INTEGER NOT NULL, rank INTEGER NOT NULL, rounds_won INTEGER NOT NULL, categories_json TEXT NOT NULL,
  joker_closes INTEGER NOT NULL, pass_activations INTEGER NOT NULL, atu_declarations INTEGER NOT NULL,
  PRIMARY KEY (match_id, seat)
);
CREATE INDEX IF NOT EXISTS idx_mp_player ON match_players(player_key);

CREATE TABLE IF NOT EXISTS achievements (key TEXT NOT NULL, tier TEXT NOT NULL, stat TEXT NOT NULL, threshold INTEGER NOT NULL, mode TEXT NOT NULL DEFAULT 'human', PRIMARY KEY (key, tier));
CREATE TABLE IF NOT EXISTS user_achievements (player_key TEXT NOT NULL, key TEXT NOT NULL, tier TEXT NOT NULL, earned_at INTEGER NOT NULL, PRIMARY KEY (player_key, key, tier));

CREATE TABLE IF NOT EXISTS friendships (user_a TEXT NOT NULL, user_b TEXT NOT NULL, status TEXT NOT NULL, requested_by TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER, PRIMARY KEY (user_a, user_b));
CREATE INDEX IF NOT EXISTS idx_friend_b ON friendships(user_b);
CREATE TABLE IF NOT EXISTS blocks (user_id TEXT NOT NULL, blocked_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (user_id, blocked_id));
CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, payload_json TEXT NOT NULL, created_at INTEGER NOT NULL, read_at INTEGER, dedupe_key TEXT UNIQUE);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, created_at);
CREATE TABLE IF NOT EXISTS push_subscriptions (endpoint TEXT PRIMARY KEY, user_id TEXT NOT NULL, keys_json TEXT NOT NULL, created_at INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS saved_matches (room_code TEXT PRIMARY KEY, saved_at INTEGER NOT NULL, players_json TEXT NOT NULL, status TEXT NOT NULL, round INTEGER);

CREATE TABLE IF NOT EXISTS tournaments (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, code TEXT NOT NULL UNIQUE, owner_id TEXT NOT NULL, format TEXT NOT NULL,
  config_json TEXT NOT NULL, points_json TEXT NOT NULL, max_players INTEGER NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, winner_id TEXT
);
CREATE TABLE IF NOT EXISTS tournament_participants (tournament_id TEXT NOT NULL, user_id TEXT NOT NULL, name TEXT NOT NULL, points INTEGER DEFAULT 0, played INTEGER DEFAULT 0, wins INTEGER DEFAULT 0, eliminated INTEGER DEFAULT 0, PRIMARY KEY (tournament_id, user_id));
CREATE TABLE IF NOT EXISTS tournament_matches (id TEXT PRIMARY KEY, tournament_id TEXT NOT NULL, round INTEGER NOT NULL, players_json TEXT NOT NULL, room_code TEXT, status TEXT NOT NULL, result_json TEXT, scheduled_at INTEGER);
CREATE INDEX IF NOT EXISTS idx_tm_t ON tournament_matches(tournament_id);

CREATE TABLE IF NOT EXISTS feature_flags (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS admin_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, admin TEXT NOT NULL, action TEXT NOT NULL, target TEXT, details_json TEXT, prev_hash TEXT NOT NULL, hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rooms_index (code TEXT PRIMARY KEY, created_at INTEGER NOT NULL, host_key TEXT, mode TEXT NOT NULL, last_seen INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS backups (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, r2_key TEXT NOT NULL, bytes INTEGER NOT NULL, tables INTEGER NOT NULL, status TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS error_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, source TEXT NOT NULL, code TEXT NOT NULL, detail TEXT);

-- seed: feature flags and achievement thresholds
INSERT OR IGNORE INTO feature_flags (key, value, updated_at) VALUES
 ('maintenance', '{"enabled":false,"emergency":false,"message":""}', 0),
 ('voice', '{"enabled":true}', 0), ('video', '{"enabled":true}', 0), ('tournaments', '{"enabled":true}', 0),
 ('limits', '{"maxRooms":500,"maxSpectators":20,"maxVideoHeight":720,"savedPerUser":10,"historyDays":365}', 0);
INSERT OR IGNORE INTO achievements (key, tier, stat, threshold, mode) VALUES
 ('primul_joc','bronze','matches',1,'any'), ('prima_victorie','bronze','wins',1,'any'), ('prima_inchidere','bronze','rounds_won',1,'any'),
 ('maestrul_suitelor','bronze','sequences',5,'human'), ('maestrul_suitelor','silver','sequences',10,'human'), ('maestrul_suitelor','gold','sequences',25,'human'),
 ('regele_tertelor','bronze','triples',5,'human'), ('regele_tertelor','gold','triples',25,'human'),
 ('regele_dublelor','bronze','doubles',5,'human'), ('regele_dublelor','silver','doubles',10,'human'), ('regele_dublelor','gold','doubles',25,'human'),
 ('maestrul_culorilor','bronze','color',5,'human'), ('maestrul_culorilor','gold','color',25,'human'),
 ('grand_master','bronze','grand',5,'human'), ('grand_master','gold','grand',25,'human'),
 ('joker_master','bronze','joker_closes',5,'human'), ('joker_master','gold','joker_closes',25,'human'),
 ('asul_atuului','bronze','atu_declarations',5,'human'), ('asul_atuului','gold','atu_declarations',25,'human'),
 ('strategul_pass','bronze','pass_activations',5,'human'), ('strategul_pass','gold','pass_activations',25,'human'),
 ('hat_trick','gold','best_streak',3,'human'), ('invincibil','diamond','best_streak',10,'human'),
 ('veteran','silver','matches',25,'human'), ('veteran','platinum','matches',100,'human'),
 ('legenda_remi','diamond','wins',100,'human'), ('campionul_mesei','gold','tournaments_won',1,'human'),
 ('gazda_perfecta','silver','hosted',10,'human'), ('masa_completa','gold','full_tables',10,'human'),
 ('antrenament','bronze','matches',1,'training'), ('antrenament','silver','matches',10,'training');
