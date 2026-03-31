// Chat message handler
import { WebSocket } from "ws";
import { Pool } from "pg";

// VIOLATION: DB access in handler (should be in persistence layer)
const pool = new Pool();

export async function handleMessage(ws: WebSocket, data: any) {
  // VIOLATION: business logic in handler (should be in domain)
  if (!data.roomId) {
    ws.send(JSON.stringify({ error: "roomId required" }));
    return;
  }

  if (data.content.length > 5000) {
    ws.send(JSON.stringify({ error: "Message too long" }));
    return;
  }

  // VIOLATION: direct DB write in handler (should go through persistence)
  const result = await pool.query(
    "INSERT INTO messages (room_id, sender_id, content) VALUES ($1, $2, $3) RETURNING *",
    [data.roomId, data.senderId, data.content]
  );

  // VIOLATION: synchronous persistence (should acknowledge first, persist after)
  ws.send(JSON.stringify({ type: "message_sent", message: result.rows[0] }));
}
