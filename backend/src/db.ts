import pg from "pg";

const { Pool } = pg;

export const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgres://sigma:sigma_dev_only@localhost:5433/sigma21001",
});
