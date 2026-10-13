import { randomUUID } from "node:crypto";

/** Persistence boundary for a runtime-defined entity. */
export interface Repository<T extends { id: string }> {
  create(data: Omit<T, "id">, id?: string): T;
  findAll(): T[];
  findPage(page: number, perPage: number): T[];
  count(): number;
  query(options: RepositoryQuery<T>): RepositoryQueryResult<T>;
  findById(id: string): T | undefined;
  update(id: string, changes: Partial<Omit<T, "id">>): T | undefined;
  delete(id: string): boolean;
}

/** A persistence-neutral read query. HTTP query engines compile into this shape. */
export interface RepositoryQuery<T> {
  predicate?: (record: T) => boolean;
  skip?: number;
  take?: number;
}

export interface RepositoryQueryResult<T> { items: T[]; total: number; }

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

  findPage(page: number, perPage: number): T[] { return this.findAll().slice((page - 1) * perPage, page * perPage); }
  count(): number { return this.items.size; }
  query({ predicate, skip = 0, take = 25 }: RepositoryQuery<T>): RepositoryQueryResult<T> {
    const matched = predicate ? this.findAll().filter(predicate) : this.findAll();
    return { total: matched.length, items: matched.slice(skip, skip + take) };
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
