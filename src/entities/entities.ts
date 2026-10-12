import type { EntityDefinitionRecord } from "../domain/entity";
import { parseEntitySource, ValidationError } from "../domain/schema";
import { EntityConflictError, type EntityModule, type EntityRuntime } from "../application/entity-runtime";

const definition = { name: "entities", fields: { name: { type: "string", required: true }, definition: { type: "string", required: true } } } as const;

function dynamicModule(record: EntityDefinitionRecord): EntityModule {
  const parsed = parseEntitySource(record.definition);
  return { definition: { name: record.name, fields: parsed.fields, documentation: parsed.documentation } };
}

/** System entity: each record deploys a regular dynamic entity. */
export function createEntitiesModule(runtime: EntityRuntime): EntityModule {
  return {
    definition,
    lifecycle: {
      beforeCreate(input) {
        if (runtime.has(input.name as string)) throw new EntityConflictError("Entity already exists");
        dynamicModule(input as EntityDefinitionRecord);
      },
      afterCreate(record) { runtime.install(dynamicModule(record as EntityDefinitionRecord)); },
      beforeUpdate(current, next) {
        if (current.name !== next.name) throw new ValidationError("Entity name cannot be changed");
        dynamicModule(next as EntityDefinitionRecord);
      },
      afterUpdate(_previous, record) { runtime.replace(record.name as string, dynamicModule(record as EntityDefinitionRecord)); },
      afterDelete(record) { runtime.remove(record.name as string); }
    }
  };
}
