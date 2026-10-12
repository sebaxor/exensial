import type { EntityDefinitionRecord } from "../domain/entity";
import { parseEntitySource, ValidationError } from "../domain/schema";
import { EntityConflictError, type EntityModule, type EntityRuntime } from "../application/entity-runtime";
import type { EntityBehaviorRegistry } from "../application/entity-behaviors";

const definition = {
  name: "entities",
  fields: {
    name: { type: "string", required: true },
    definition: { type: "string", required: true },
    namespace: { type: "string", required: false },
    module: { type: "string", required: false }
  }
} as const;

function dynamicModule(record: EntityDefinitionRecord, behaviors: EntityBehaviorRegistry): EntityModule {
  const parsed = parseEntitySource(record.definition);
  const behavior = record.module ? behaviors.get(record.module) : undefined;
  if (record.module && !behavior) throw new ValidationError(`Unknown behavior module: ${record.module}`);
  return {
    definition: {
      name: record.name,
      fields: parsed.fields,
      documentation: parsed.documentation,
      context: {
        namespace: record.namespace,
        module: record.module,
        operations: behavior ? Object.keys(behavior.operations) : undefined
      }
    },
    operations: behavior?.operations
  };
}

/** System entity: each record deploys a regular dynamic entity. */
export function createEntitiesModule(runtime: EntityRuntime, behaviors: EntityBehaviorRegistry): EntityModule {
  return {
    definition,
    lifecycle: {
      beforeCreate(input) {
        if (runtime.has(input.name as string)) throw new EntityConflictError("Entity already exists");
        dynamicModule(input as EntityDefinitionRecord, behaviors);
      },
      afterCreate(record) { runtime.install(dynamicModule(record as EntityDefinitionRecord, behaviors)); },
      beforeUpdate(current, next) {
        if (current.name !== next.name) throw new ValidationError("Entity name cannot be changed");
        dynamicModule(next as EntityDefinitionRecord, behaviors);
      },
      afterUpdate(_previous, record) { runtime.replace(record.name as string, dynamicModule(record as EntityDefinitionRecord, behaviors)); },
      afterDelete(record) { runtime.remove(record.name as string); }
    }
  };
}
