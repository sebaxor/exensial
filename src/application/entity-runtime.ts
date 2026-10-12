import type { EntityDefinition, EntityRecord } from "../domain/entity";
import { InMemoryRepository, type Repository } from "../domain/repository";
import { ValidationError, validateRecord } from "../domain/schema";

export type CrudAction = "create" | "list" | "get" | "update" | "delete";

export interface EntityLifecycle {
  beforeCreate?(input: Record<string, unknown>): void | Promise<void>;
  afterCreate?(record: EntityRecord): void | Promise<void>;
  beforeUpdate?(current: EntityRecord, next: Record<string, unknown>): void | Promise<void>;
  afterUpdate?(previous: EntityRecord, record: EntityRecord): void | Promise<void>;
  beforeDelete?(record: EntityRecord): void | Promise<void>;
  afterDelete?(record: EntityRecord): void | Promise<void>;
}

export interface EntityModule {
  definition: EntityDefinition;
  lifecycle?: EntityLifecycle;
}

type ActiveEntity = EntityModule & { repository: Repository<EntityRecord> };

export class EntityRuntime {
  private readonly entities = new Map<string, ActiveEntity>();

  install(module: EntityModule): void {
    if (this.entities.has(module.definition.name)) throw new EntityConflictError(`Entity already exists: ${module.definition.name}`);
    this.entities.set(module.definition.name, { ...module, repository: new InMemoryRepository<EntityRecord>() });
  }

  replace(name: string, module: EntityModule): void {
    const current = this.entities.get(name);
    if (!current) throw new EntityNotFoundError();
    if (name !== module.definition.name && this.entities.has(module.definition.name)) throw new EntityConflictError(`Entity already exists: ${module.definition.name}`);
    this.entities.delete(name);
    this.entities.set(module.definition.name, { ...module, repository: current.repository });
  }

  remove(name: string): void {
    if (!this.entities.delete(name)) throw new EntityNotFoundError();
  }

  has(name: string): boolean { return this.entities.has(name); }

  assertRecord(entityName: string, id?: string): void {
    const entity = this.entities.get(entityName);
    if (!entity) throw new EntityNotFoundError("Entity not found");
    this.requireRecord(entity, id);
  }

  async execute(entityName: string, action: CrudAction, id?: string, input?: unknown): Promise<EntityRecord | EntityRecord[] | undefined> {
    const entity = this.entities.get(entityName);
    if (!entity) throw new EntityNotFoundError("Entity not found");
    switch (action) {
      case "list": return entity.repository.findAll();
      case "get": return this.requireRecord(entity, id);
      case "create": return this.create(entity, input);
      case "update": return this.update(entity, id, input);
      case "delete":
        await this.delete(entity, id);
        return undefined;
    }
  }

  private async create(entity: ActiveEntity, input: unknown): Promise<EntityRecord> {
    const data = validateRecord(input, entity.definition.fields);
    await entity.lifecycle?.beforeCreate?.(data);
    const record = entity.repository.create(data as Omit<EntityRecord, "id">);
    await entity.lifecycle?.afterCreate?.(record);
    return record;
  }

  private async update(entity: ActiveEntity, id: string | undefined, input: unknown): Promise<EntityRecord> {
    const current = this.requireRecord(entity, id);
    const changes = validateRecord(input, entity.definition.fields, true);
    const next = { ...current, ...changes };
    await entity.lifecycle?.beforeUpdate?.(current, next);
    const record = entity.repository.update(current.id, changes as Partial<Omit<EntityRecord, "id">>);
    if (!record) throw new EntityNotFoundError("Record not found");
    await entity.lifecycle?.afterUpdate?.(current, record);
    return record;
  }

  private async delete(entity: ActiveEntity, id: string | undefined): Promise<void> {
    const record = this.requireRecord(entity, id);
    await entity.lifecycle?.beforeDelete?.(record);
    entity.repository.delete(record.id);
    await entity.lifecycle?.afterDelete?.(record);
  }

  private requireRecord(entity: ActiveEntity, id?: string): EntityRecord {
    if (!id) throw new EntityNotFoundError("Record not found");
    const record = entity.repository.findById(id);
    if (!record) throw new EntityNotFoundError("Record not found");
    return record;
  }
}

export class EntityNotFoundError extends Error {}
export class EntityConflictError extends Error {}
export { ValidationError };
