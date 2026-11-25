import pg from "pg";
import { pool as rootPool } from "../db.js";

export { rootPool as pool };
export type { PoolClient } from "pg";
