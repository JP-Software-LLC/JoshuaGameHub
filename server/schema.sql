-- Joshua Game Hub — teacher accounts + class results.
-- Students never get accounts: a student is a first name + last initial + nickname inside one
-- teacher's class, recognised on later visits by their device token (a random ID saved in the browser).
-- No emails, passwords, last names or IP addresses are ever stored for students.

CREATE TABLE IF NOT EXISTS teachers (
  id            BIGSERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,              -- lower-cased
  display_name  TEXT NOT NULL DEFAULT '',
  school_id     TEXT,                              -- id from server/schools.json
  google_sub    TEXT UNIQUE,                       -- Google account id, if they used Google sign-in
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

-- one-time email login links (only a SHA-256 hash of the token is stored)
CREATE TABLE IF NOT EXISTS login_links (
  token_hash  TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ
);

-- signed-in sessions (only a hash of the bearer token is stored)
CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash  TEXT PRIMARY KEY,
  teacher_id  BIGINT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);
-- set when a site admin opens a read-only "view as this teacher" session (id of the admin)
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS viewed_by BIGINT REFERENCES teachers(id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS classes (
  id          BIGSERIAL PRIMARY KEY,
  owner_id    BIGINT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- co-teachers. role: 'owner' (exactly one, also classes.owner_id) or 'coteacher' (view results only)
CREATE TABLE IF NOT EXISTS class_members (
  class_id    BIGINT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  teacher_id  BIGINT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('owner','coteacher')),
  added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (class_id, teacher_id)
);

-- co-teacher invites: bound to one email address, single use, expire after 7 days
CREATE TABLE IF NOT EXISTS class_invites (
  token_hash  TEXT PRIMARY KEY,
  class_id    BIGINT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  invited_by  BIGINT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS students (
  id            BIGSERIAL PRIMARY KEY,
  class_id      BIGINT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  first_name    TEXT NOT NULL,
  last_initial  TEXT NOT NULL DEFAULT '',
  nickname      TEXT NOT NULL DEFAULT '',
  device_token  TEXT,                              -- browser's random id; recognises the student next time
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS students_class_device ON students(class_id, device_token);

-- one finished Teacher Mode game
CREATE TABLE IF NOT EXISTS game_sessions (
  id           BIGSERIAL PRIMARY KEY,
  class_id     BIGINT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  saved_by     BIGINT REFERENCES teachers(id) ON DELETE SET NULL,
  game         TEXT NOT NULL,                      -- math · arrows · rush · hurdle · bear · memory · typing · cannons · darts · sky · words
  mode         TEXT,                               -- e.g. Math Race question type
  room_code    TEXT,
  started_at   TIMESTAMPTZ,
  ended_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  player_count INT NOT NULL DEFAULT 0,
  summary      JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS game_sessions_class ON game_sessions(class_id, ended_at DESC);

-- each student's result in that game (place, score, game-specific stats, per-question log)
CREATE TABLE IF NOT EXISTS session_results (
  session_id  BIGINT NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  student_id  BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  place       INT,
  score       DOUBLE PRECISION,
  stats       JSONB NOT NULL DEFAULT '{}'::jsonb,
  log         JSONB NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (session_id, student_id)
);
CREATE INDEX IF NOT EXISTS session_results_student ON session_results(student_id);

-- site analytics: daily totals only (see server/stats.js). Nothing here identifies a person.
CREATE TABLE IF NOT EXISTS daily_stats (
  day     DATE NOT NULL,
  metric  TEXT NOT NULL,
  n       BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (day, metric)
);

-- ---- schools (editable on /admin/schools/; first run is seeded from server/schools.json)
CREATE TABLE IF NOT EXISTS schools (
  id          TEXT PRIMARY KEY,                    -- never changes: stored on teachers and students
  name        TEXT NOT NULL,
  state       TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE students ADD COLUMN IF NOT EXISTS school_id TEXT;

-- ---- castles: every saved Teacher Mode game adds bricks to the castle of the teacher who ran it.
-- Bricks only ever go up (deleting a game or class doesn't knock bricks off).
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS bricks BIGINT NOT NULL DEFAULT 0;
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS castle_games INT NOT NULL DEFAULT 0;
ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS bricks INT NOT NULL DEFAULT 0;
ALTER TABLE session_results ADD COLUMN IF NOT EXISTS bricks INT NOT NULL DEFAULT 0;
-- running average of each game's raw score (all students, all saved games): an average result = 100 bricks in any game
CREATE TABLE IF NOT EXISTS game_scale (
  game   TEXT PRIMARY KEY,
  n      DOUBLE PRECISION NOT NULL DEFAULT 0,
  total  DOUBLE PRECISION NOT NULL DEFAULT 0
);

-- ---- tournaments: a school's castles race from 0 to `goal` bricks (only games saved after the start count). First to the goal wins.
CREATE TABLE IF NOT EXISTS tournaments (
  id          BIGSERIAL PRIMARY KEY,
  school_id   TEXT NOT NULL,
  name        TEXT NOT NULL,
  goal        INT NOT NULL,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at    TIMESTAMPTZ,                         -- set when someone wins or an admin stops it
  winner_id   BIGINT REFERENCES teachers(id) ON DELETE SET NULL,
  winner_name TEXT,                                -- kept even if the account goes away
  created_by  BIGINT REFERENCES teachers(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS tournaments_school ON tournaments(school_id, started_at DESC);
ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS saved_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- passwords (scrypt) + one recovery question (answer hashed the same way); lockout after repeated failures
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS pw_hash TEXT;
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS pw_set_at TIMESTAMPTZ;
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS must_change BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS recovery_q TEXT;
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS recovery_hash TEXT;
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS failed_logins INT NOT NULL DEFAULT 0;
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
-- how a session was opened: password · google · link (email link) · email (EMAIL_VERIFY=off) · recover · view
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS method TEXT;

-- ---- student activity for the admin Students board: one row when a named student joins a teacher's room ('join')
-- and one per student each time a game starts there ('play'). Same first name + last initial = one student.
CREATE TABLE IF NOT EXISTS student_activity (
  id            BIGSERIAL PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('join','play')),
  first_name    TEXT NOT NULL,
  last_initial  TEXT NOT NULL DEFAULT '',
  nickname      TEXT NOT NULL DEFAULT '',
  school_id     TEXT,
  game          TEXT NOT NULL,
  room_code     TEXT,
  teacher_id    BIGINT REFERENCES teachers(id) ON DELETE SET NULL,
  at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS student_activity_at ON student_activity(at DESC);
