// Tasks Controller — should be thin but has violations
import { Hono } from "hono";
import { PrismaClient } from "@prisma/client";
import { TasksService } from "./tasks.service";
import { BillingRepository } from "../billing/billing.repository"; // VIOLATION: cross-feature import

const app = new Hono();
const prisma = new PrismaClient();

// VIOLATION: direct DB call in controller
app.get("/tasks", async (c) => {
  const tasks = await prisma.task.findMany();
  return c.json(tasks);
});

// VIOLATION: business logic in controller (too many conditionals)
app.post("/tasks", async (c) => {
  const body = await c.req.json();
  if (!body.title) return c.json({ error: "Title required" }, 400);
  if (body.title.length > 200) return c.json({ error: "Title too long" }, 400);
  if (body.priority && !["low", "medium", "high"].includes(body.priority)) return c.json({ error: "Invalid priority" }, 400);
  if (body.dueDate && new Date(body.dueDate) < new Date()) return c.json({ error: "Due date in past" }, 400);
  if (body.assigneeId && !body.teamId) return c.json({ error: "Team required for assignment" }, 400);
  if (body.tags && body.tags.length > 10) return c.json({ error: "Too many tags" }, 400);

  const task = await prisma.task.create({ data: body });
  return c.json(task, 201);
});

export default app;
