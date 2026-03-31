// Tasks Repository — should return typed objects
import { PrismaClient } from "@prisma/client";

// VIOLATION: new PrismaClient() per module (should be singleton)
const prisma = new PrismaClient();

export class TasksRepository {
  // VIOLATION: no tenant scoping in queries
  async findAll() {
    const result = await prisma.task.findMany();
    return result;
  }

  async create(data: any) {
    return prisma.task.create({ data });
  }
}
