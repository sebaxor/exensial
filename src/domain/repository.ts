import { randomUUID } from "node:crypto";

/** Persistence boundary for a runtime-defined entity. */
export interface Repository<T extends { id: string }> {
  create(data: Omit<T, "id">, id?: string): T;
  findAll(): T[];
  findById(id: string): T | undefined;
  update(id: string, changes: Partial<Omit<T, "id">>): T | undefined;
  delete(id: string): boolean;
}

export class InMemoryRepository<T extends { id: string }> implements Repository<T> {
  private readonly items = new Map<string, T>();

  create(data: Omit<T, "id">, id = randomUUID()): T {
    const item = { ...data, id } as T;
    this.items.set(item.id, item);
    return item;
  }

  findAll(): T[] {
    return [...this.items.values()];
  }

  findById(id: string): T | undefined {
    return this.items.get(id);
  }

  update(id: string, changes: Partial<Omit<T, "id">>): T | undefined {
    const item = this.findById(id);
    if (!item) return undefined;
    const updated = { ...item, ...changes, id };
    this.items.set(id, updated);
    return updated;
  }

  delete(id: string): boolean {
    return this.items.delete(id);
  }
}
