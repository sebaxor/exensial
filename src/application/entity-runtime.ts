import type { EntityDefinition, EntityRecord } from "../domain/entity";
import type { CrudAction, DomainRequest, PayloadPattern } from "../domain/request";
import { InMemoryRepository, type Repository } from "../domain/repository";
import { ValidationError, validateRecord } from "../domain/schema";

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

  async execute(request: DomainRequest): Promise<EntityRecord | EntityRecord[] | undefined> {
    const entity = this.entities.get(request.entityName);
    if (!entity) throw new EntityNotFoundError("Entity not found");
    switch (request.action) {
      case "list": return entity.repository.findAll();
      case "get": return this.requireRecord(entity, request.id);
      case "create": return this.create(entity, this.onePayload(request.payload));
      case "bulkCreate": return this.createMany(entity, this.manyPayload(request.payload));
      case "replace": return this.update(entity, request.id, this.onePayload(request.payload), false);
      case "update": return this.update(entity, request.id, this.onePayload(request.payload), true);
      case "delete":
        await this.delete(entity, request.id);
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

  private async createMany(entity: ActiveEntity, inputs: unknown[]): Promise<EntityRecord[]> {
    // Validate every imported record before the first write.
    const records = inputs.map((input) => validateRecord(input, entity.definition.fields));
    const created: EntityRecord[] = [];
    for (const data of records) {
      await entity.lifecycle?.beforeCreate?.(data);
      const record = entity.repository.create(data as Omit<EntityRecord, "id">);
      await entity.lifecycle?.afterCreate?.(record);
      created.push(record);
    }
    return created;
  }

  private async update(entity: ActiveEntity, id: string | undefined, input: unknown, partial: boolean): Promise<EntityRecord> {
    const current = this.requireRecord(entity, id);
    const changes = validateRecord(input, entity.definition.fields, partial);
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

  private onePayload(payload?: PayloadPattern): unknown {
    if (payload?.kind !== "one") throw new ValidationError("Expected one JSON object");
    return payload.value;
  }

  private manyPayload(payload?: PayloadPattern): unknown[] {
    if (payload?.kind !== "many") throw new ValidationError("Expected an array of JSON objects");
    if (!payload.values.length) throw new ValidationError("Bulk creation requires at least one record");
    return payload.values;
  }
}

export class EntityNotFoundError extends Error {}
export class EntityConflictError extends Error {}
export { ValidationError };
