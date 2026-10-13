import type { EntityDefinition, EntityRecord } from "../domain/entity";
import type { DomainRequest, PayloadPattern } from "../domain/request";
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
  operations?: Partial<Record<DomainRequest["action"], EntityOperationMiddleware | EntityOperationMiddleware[]>>;
}

export interface EntityOperationContext {
  runtime: EntityRuntime;
  request: DomainRequest;
  definition: EntityDefinition;
  input?: Record<string, unknown> | Record<string, unknown>[];
  current?: EntityRecord;
  result?: EntityRecord | EntityRecord[];
}

export type EntityOperationMiddleware = (context: EntityOperationContext, next: () => Promise<void>) => Promise<void>;

type ActiveEntity = EntityModule & { repository: Repository<EntityRecord> };

export class EntityRuntime {
  private readonly entities = new Map<string, ActiveEntity>();

  install(module: EntityModule): void {
    const key = entityKey(module.definition.name, module.definition.context?.namespace, module.definition.context?.version);
    if (this.entities.has(key)) throw new EntityConflictError(`Entity already exists: ${key}`);
    this.entities.set(key, { ...module, repository: new InMemoryRepository<EntityRecord>() });
  }

  installIfMissing(module: EntityModule): boolean {
    if (this.hasExact(module.definition.name, module.definition.context?.namespace, module.definition.context?.version)) return false;
    this.install(module);
    return true;
  }

  replace(name: string, module: EntityModule, namespace?: string): void {
    const oldKey = entityKey(name, namespace, module.definition.context?.version);
    const newKey = entityKey(module.definition.name, module.definition.context?.namespace, module.definition.context?.version);
    const current = this.entities.get(oldKey);
    if (!current) throw new EntityNotFoundError();
    if (oldKey !== newKey && this.entities.has(newKey)) throw new EntityConflictError(`Entity already exists: ${newKey}`);
    this.entities.delete(oldKey);
    this.entities.set(newKey, { ...module, repository: current.repository });
  }

  remove(name: string, namespace?: string, version?: string): void {
    if (!this.entities.delete(entityKey(name, namespace, version))) throw new EntityNotFoundError();
  }

  has(name: string, namespace?: string, apiVersion?: string): boolean { return Boolean(this.resolve(name, namespace, apiVersion)); }
  hasExact(name: string, namespace?: string, version = "1.0.0"): boolean { return this.entities.has(entityKey(name, namespace, version)); }

  definitions(apiVersion?: string): EntityDefinition[] {
    if (!apiVersion) apiVersion = `v${this.latestMajor()}`;
    const selected = new Map<string, EntityDefinition>();
    for (const { definition } of this.entities.values()) {
      if (major(definition.context?.version) !== apiVersion) continue;
      const key = logicalKey(definition.name, definition.context?.namespace);
      const existing = selected.get(key);
      if (!existing || compareVersion(definition.context?.version, existing.context?.version) > 0) selected.set(key, definition);
    }
    return [...selected.values()];
  }

  assertRecord(entityName: string, id?: string, namespace?: string, apiVersion?: string): void {
    const entity = this.resolve(entityName, namespace, apiVersion);
    if (!entity) throw new EntityNotFoundError("Entity not found");
    this.requireRecord(entity, id);
  }

  findRecord(entityName: string, id: string, namespace?: string): EntityRecord | undefined {
    return this.resolve(entityName, namespace)?.repository.findById(id);
  }

  count(entityName: string, namespace?: string, apiVersion?: string): number {
    return this.resolve(entityName, namespace, apiVersion)?.repository.count() ?? 0;
  }

  listRecords(entityName: string, namespace?: string): EntityRecord[] {
    const entity = this.resolve(entityName, namespace);
    if (!entity) throw new EntityNotFoundError("Entity not found");
    return entity.repository.query({ take: 100_000 }).items;
  }

  query(entityName: string, predicate: (record: EntityRecord) => boolean, options: { skip: number; take: number }, namespace?: string, apiVersion?: string): { items: EntityRecord[]; total: number } {
    const entity = this.resolve(entityName, namespace, apiVersion);
    if (!entity) throw new EntityNotFoundError("Entity not found");
    return entity.repository.query({ predicate, ...options });
  }

  latestMajor(): number {
    return Math.max(1, ...[...this.entities.values()].map(({ definition }) => Number(major(definition.context?.version).slice(1))));
  }

  private resolve(name: string, namespace?: string, apiVersion?: string): ActiveEntity | undefined {
    const target = apiVersion ?? `v${this.latestMajor()}`;
    return [...this.entities.values()]
      .filter(({ definition }) => definition.name === name && definition.context?.namespace === namespace && major(definition.context?.version) === target)
      .sort((a, b) => compareVersion(b.definition.context?.version, a.definition.context?.version))[0];
  }

  async execute(request: DomainRequest, options: { createId?: string } = {}): Promise<EntityRecord | EntityRecord[] | undefined> {
    const entity = this.entities.get(entityKey(request.entityName, request.namespace));
    if (!entity) throw new EntityNotFoundError("Entity not found");
    const context: EntityOperationContext = { runtime: this, request, definition: entity.definition };
    this.prepareContext(entity, context);
    await runOperationMiddleware(context, operationMiddleware(entity, request.action), () => this.executeDefault(entity, context, options));
    return context.result;
  }

  private prepareContext(entity: ActiveEntity, context: EntityOperationContext): void {
    const { request } = context;
    if (request.action === "create") context.input = validateRecord(this.onePayload(request.payload), entity.definition.fields);
    if (request.action === "bulkCreate") context.input = this.manyPayload(request.payload).map((input) => validateRecord(input, entity.definition.fields));
    if (request.action === "replace" || request.action === "update") {
      context.current = this.requireRecord(entity, request.id);
      context.input = validateRecord(this.onePayload(request.payload), entity.definition.fields, request.action === "update");
    }
    if (request.action === "get" || request.action === "delete") context.current = this.requireRecord(entity, request.id);
  }

  private async executeDefault(entity: ActiveEntity, context: EntityOperationContext, options: { createId?: string }): Promise<void> {
    const { action } = context.request;
    if (action === "list") context.result = entity.repository.findPage(context.request.pagination?.page ?? 1, context.request.pagination?.perPage ?? 25);
    if (action === "get") context.result = context.current;
    if (action === "create") context.result = await this.create(entity, context.input as Record<string, unknown>, options.createId);
    if (action === "bulkCreate") context.result = await this.createMany(entity, context.input as Record<string, unknown>[]);
    if (action === "replace" || action === "update") context.result = await this.update(entity, context.current!, context.input as Record<string, unknown>);
    if (action === "delete") await this.delete(entity, context.current!);
  }

  private async create(entity: ActiveEntity, data: Record<string, unknown>, id?: string): Promise<EntityRecord> {
    await entity.lifecycle?.beforeCreate?.(data);
    if (id && entity.repository.findById(id)) throw new EntityConflictError(`Record already exists: ${id}`);
    const record = entity.repository.create(data as Omit<EntityRecord, "id">, id);
    await entity.lifecycle?.afterCreate?.(record);
    return record;
  }

  private async createMany(entity: ActiveEntity, records: Record<string, unknown>[]): Promise<EntityRecord[]> {
    const created: EntityRecord[] = [];
    for (const data of records) {
      await entity.lifecycle?.beforeCreate?.(data);
      const record = entity.repository.create(data as Omit<EntityRecord, "id">);
      await entity.lifecycle?.afterCreate?.(record);
      created.push(record);
    }
    return created;
  }

  private async update(entity: ActiveEntity, current: EntityRecord, changes: Record<string, unknown>): Promise<EntityRecord> {
    const next = { ...current, ...changes };
    await entity.lifecycle?.beforeUpdate?.(current, next);
    const record = entity.repository.update(current.id, changes as Partial<Omit<EntityRecord, "id">>);
    if (!record) throw new EntityNotFoundError("Record not found");
    await entity.lifecycle?.afterUpdate?.(current, record);
    return record;
  }

  private async delete(entity: ActiveEntity, record: EntityRecord): Promise<void> {
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

function entityKey(name: string, namespace?: string, version = "1.0.0"): string {
  return `${namespace ? `${namespace}/` : ""}${name}@${version}`;
}
function logicalKey(name: string, namespace?: string): string { return namespace ? `${namespace}/${name}` : name; }
function major(version = "1.0.0"): string { const match = version.match(/^(\d+)\.\d+\.\d+$/); if (!match) throw new ValidationError(`Invalid semantic version: ${version}`); return `v${match[1]}`; }
function compareVersion(left = "1.0.0", right = "1.0.0"): number { const a = left.split(".").map(Number), b = right.split(".").map(Number); return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]; }

function operationMiddleware(entity: ActiveEntity, action: DomainRequest["action"]): EntityOperationMiddleware[] {
  const middleware = entity.operations?.[action];
  return !middleware ? [] : Array.isArray(middleware) ? middleware : [middleware];
}

async function runOperationMiddleware(context: EntityOperationContext, middleware: EntityOperationMiddleware[], terminal: () => Promise<void>): Promise<void> {
  let index = -1;
  const dispatch = async (position: number): Promise<void> => {
    if (position <= index) throw new Error("Entity operation next() called more than once");
    index = position;
    const handler = middleware[position];
    if (handler) return handler(context, () => dispatch(position + 1));
    return terminal();
  };
  await dispatch(0);
}

export class EntityNotFoundError extends Error {}
export class EntityConflictError extends Error {}
export { ValidationError };
