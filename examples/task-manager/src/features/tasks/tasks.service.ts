// Tasks Service — business logic
import { TasksRepository } from "./tasks.repository";
import { CreateTaskDto, Task } from "./tasks.types";

export class TasksService {
  constructor(private repo: TasksRepository) {}

  async createTask(tenantId: string, dto: CreateTaskDto): Promise<Task> {
    return this.repo.create(tenantId, dto);
  }

  async listTasks(tenantId: string): Promise<Task[]> {
    return this.repo.findAll(tenantId);
  }
}
