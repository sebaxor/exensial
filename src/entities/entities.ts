import type { EntityDefinitionRecord } from "../domain/entity";
import { parseEntitySource, ValidationError } from "../domain/schema";
import { EntityConflictError, type EntityModule, type EntityRuntime } from "../application/entity-runtime";
import type { EntityBehaviorRegistry } from "../application/entity-behaviors";
import { compileRuntimeLogic } from "../application/runtime-logic";

const definition = {
  name: "entities",
  documentation: {
    title: { en: "Entity catalog" },
    description: {
      en: "Creates, updates, and removes runtime REST entities from TypeScript type aliases."
    }
  },
  fields: {
    name: { type: "string", required: true, documentation: { title: { en: "Route name" } } },
    definition: { type: "string", required: true, documentation: { title: { en: "TypeScript type" } } },
    namespace: { type: "string", required: false, documentation: { title: { en: "Namespace" } } },
    module: { type: "string", required: false, documentation: { title: { en: "Trusted behavior module" } } },
    behavior: { type: "json", required: false, documentation: { title: { en: "Behavior configuration" } } },
    logic: { type: "json", required: false, documentation: { title: { en: "Runtime business logic" } } }
  }
} satisfies EntityModule["definition"];

function dynamicModule(record: EntityDefinitionRecord, behaviors: EntityBehaviorRegistry): EntityModule {
  const parsed = parseEntitySource(record.definition);
  const behavior = record.module ? behaviors.get(record.module) : undefined;
  if (record.module && !behavior) throw new ValidationError(`Unknown behavior module: ${record.module}`);
  behavior?.validateConfiguration?.(record.behavior);
  const logic = compileRuntimeLogic(record.logic);
  return {
    definition: {
      name: record.name,
      fields: parsed.fields,
      documentation: parsed.documentation,
      context: {
        namespace: record.namespace,
        module: record.module,
        behavior: record.behavior,
        logic: record.logic,
        operations: [...Object.keys(behavior?.operations ?? {}), ...Object.keys(logic ?? {})]
      }
    },
    operations: { ...behavior?.operations, ...logic }
  };
}

/** System entity: each record deploys a regular dynamic entity. */
export function createEntitiesModule(runtime: EntityRuntime, behaviors: EntityBehaviorRegistry): EntityModule {
  return {
    definition,
    lifecycle: {
      beforeCreate(input) {
        if (runtime.has(input.name as string, input.namespace as string | undefined)) throw new EntityConflictError("Entity already exists");
        dynamicModule(input as EntityDefinitionRecord, behaviors);
      },
      afterCreate(record) { runtime.install(dynamicModule(record as EntityDefinitionRecord, behaviors)); },
      beforeUpdate(current, next) {
        if (current.name !== next.name) throw new ValidationError("Entity name cannot be changed");
        if (current.namespace !== next.namespace && runtime.has(next.name as string, next.namespace as string | undefined)) {
          throw new EntityConflictError("Entity already exists");
        }
        dynamicModule(next as EntityDefinitionRecord, behaviors);
      },
      afterUpdate(previous, record) {
        runtime.replace(previous.name as string, dynamicModule(record as EntityDefinitionRecord, behaviors), previous.namespace as string | undefined);
      },
      afterDelete(record) { runtime.remove(record.name as string, record.namespace as string | undefined); }
    }
  };
}
