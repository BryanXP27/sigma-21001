import { pool } from "./db.js";

export async function applyRuntimeMigrations(): Promise<void> {
  await pool.query(`
    ALTER TABLE students
      ADD COLUMN IF NOT EXISTS family_qr_token text
        DEFAULT encode(gen_random_bytes(24), 'hex');
    UPDATE students
       SET family_qr_token = encode(gen_random_bytes(24), 'hex')
     WHERE family_qr_token IS NULL;
    ALTER TABLE students ALTER COLUMN family_qr_token SET NOT NULL;
    ALTER TABLE students ALTER COLUMN family_qr_token
      SET DEFAULT encode(gen_random_bytes(24), 'hex');
    CREATE UNIQUE INDEX IF NOT EXISTS students_family_qr_token_idx
      ON students (family_qr_token);

    ALTER TABLE users ADD COLUMN IF NOT EXISTS phone varchar(9);
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS token_version integer NOT NULL DEFAULT 0;

    CREATE TABLE IF NOT EXISTS auth_challenges (
      id uuid PRIMARY KEY,
      purpose text NOT NULL CHECK (purpose IN ('family', 'password_reset')),
      user_id uuid REFERENCES users(id) ON DELETE CASCADE,
      guardian_id uuid REFERENCES guardians(id) ON DELETE CASCADE,
      student_id varchar(14) REFERENCES students(siagie_code) ON DELETE CASCADE,
      code_hash text NOT NULL,
      expires_at timestamptz NOT NULL,
      attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
      consumed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      request_ip inet
    );
    CREATE INDEX IF NOT EXISTS auth_challenges_rate_idx
      ON auth_challenges (purpose, guardian_id, user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS notification_outbox (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      alert_id uuid NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
      recipient_phone varchar(9) NOT NULL,
      channel text NOT NULL CHECK (channel IN ('sms', 'whatsapp')),
      provider text NOT NULL,
      status text NOT NULL CHECK (status IN ('queued', 'simulated', 'sent', 'failed')),
      created_by text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}
