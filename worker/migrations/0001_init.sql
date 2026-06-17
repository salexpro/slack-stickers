CREATE TABLE workspaces (
  team_id      TEXT PRIMARY KEY,
  bot_token    TEXT NOT NULL,
  installed_at INTEGER NOT NULL
);

CREATE TABLE links (
  team_id          TEXT NOT NULL,
  slack_user_id    TEXT NOT NULL,
  telegram_user_id INTEGER NOT NULL,
  created_at       INTEGER NOT NULL,
  PRIMARY KEY (team_id, slack_user_id)
);

CREATE TABLE link_tokens (
  token            TEXT PRIMARY KEY,
  telegram_user_id INTEGER NOT NULL,
  expires_at       INTEGER NOT NULL
);

CREATE TABLE stickers (
  file_unique_id TEXT PRIMARY KEY,
  ext            TEXT NOT NULL,
  animated       INTEGER NOT NULL,
  r2_key         TEXT NOT NULL,
  public_url     TEXT NOT NULL,
  created_at     INTEGER NOT NULL
);

CREATE TABLE user_stickers (
  telegram_user_id INTEGER NOT NULL,
  file_unique_id   TEXT NOT NULL,
  added_at         INTEGER NOT NULL,
  PRIMARY KEY (telegram_user_id, file_unique_id)
);

CREATE INDEX idx_user_stickers_user ON user_stickers (telegram_user_id, added_at DESC);
