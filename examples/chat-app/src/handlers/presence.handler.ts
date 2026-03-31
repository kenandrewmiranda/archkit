// Presence handler
import { Pool } from "pg";

const pool = new Pool();

export async function handlePresence(userId: string, status: "online" | "offline") {
  // VIOLATION: persisting presence to DB (should be ephemeral Valkey TTL keys)
  await pool.query(
    "UPDATE users SET status = $1, last_seen = NOW() WHERE id = $2",
    [status, userId]
  );
}
