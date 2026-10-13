import type { EntityDefinitionRecord } from "../domain/entity";
import { parseEntitySource, ValidationError } from "../domain/schema";
import { EntityConflictError, type EntityModule, type EntityRuntime } from "../application/entity-runtime";
import type { EntityBehaviorRegistry } from "../application/entity-behaviors";
import { compileRuntimeLogic } from "../application/runtime-logic";
import { compileRuntimeCode } from "../application/runtime-code";

const definition = {
  name: "entities",
  context: { version: "1.0.0", group: "System" },
  documentation: {
    title: { en: "Entity catalog" },
    description: {
      en: "Creates, updates, and removes runtime REST entities from TypeScript type aliases."
    }
  },
  fields: {
    name: { type: "string", required: true, documentation: { title: { en: "Route name" }, description: { en: "Final route segment. With namespace library, books becomes /v1/library/books." } } },
    version: { type: "string", required: false, documentation: { title: { en: "Entity version" }, description: { en: "Semantic version such as 1.0.0. Required for new definitions; omitted legacy definitions migrate to 1.0.0." } } },
    definition: { type: "string", required: true, documentation: { title: { en: "TypeScript type" }, description: { en: "The entity type alias and its Exensial JSDoc metadata." } }, ui: { control: "textarea" } },
    namespace: { type: "string", required: false, documentation: { title: { en: "Namespace" }, description: { en: "Optional route segment before the route name; it scopes an entity without replacing its name." } } },
    group: { type: "string", required: false, documentation: { title: { en: "Console menu group" }, description: { en: "Presentation-only group in the generic console; it does not affect the REST route." } } },
    module: { type: "string", required: false, documentation: { title: { en: "Trusted behavior module" }, description: { en: "Optional server-registered behavior module id." } } },
    behavior: { type: "json", required: false, documentation: { title: { en: "Behavior configuration" }, description: { en: "JSON configuration consumed by the selected trusted behavior module." } }, ui: { control: "textarea" } },
    logic: { type: "json", required: false, documentation: { title: { en: "Declarative business logic" }, description: { en: "Optional portable JSON rules run around CRUD operations." } }, ui: { control: "textarea" } },
    code: { type: "string", required: false, documentation: { title: { en: "Runtime TypeScript domain module" }, description: { en: "Optional high-level domain module. This source is intentionally multi-line." } }, ui: { control: "textarea" } }
  }
} satisfies EntityModule["definition"];

function dynamicModule(record: EntityDefinitionRecord, behaviors: EntityBehaviorRegistry): EntityModule {
  const parsed = parseEntitySource(record.definition);
  const behavior = record.module ? behaviors.get(record.module) : undefined;
  if (record.module && !behavior) throw new ValidationError(`Unknown behavior module: ${record.module}`);
  behavior?.validateConfiguration?.(record.behavior);
  const logic = compileRuntimeLogic(record.logic);
  const code = compileRuntimeCode(record.code);
  return {
    definition: {
      name: record.name,
      fields: parsed.fields,
      documentation: parsed.documentation,
      context: {
        namespace: record.namespace,
        version: record.version ?? "1.0.0",
        group: record.group,
        module: record.module,
        behavior: record.behavior,
        logic: record.logic,
        code: record.code,
        operations: [...new Set([...Object.keys(behavior?.operations ?? {}), ...Object.keys(logic ?? {}), ...Object.keys(code ?? {})])]
      }
    },
    operations: mergeOperations(behavior?.operations, logic, code)
  };
}

function mergeOperations(...sources: Array<EntityModule["operations"] | undefined>): EntityModule["operations"] {
  const result: NonNullable<EntityModule["operations"]> = {};
  for (const source of sources) {
    for (const [action, operation] of Object.entries(source ?? {})) {
      const existing = result[action as keyof typeof result];
      result[action as keyof typeof result] = existing
        ? [...(Array.isArray(existing) ? existing : [existing]), ...(Array.isArray(operation) ? operation : [operation])]
        : operation;
    }
  }
  return result;
}

/** System entity: each record deploys a regular dynamic entity. */
export function createEntitiesModule(runtime: EntityRuntime, behaviors: EntityBehaviorRegistry): EntityModule {
  return {
    definition,
    lifecycle: {
      beforeCreate(input) {
        if (runtime.hasExact(input.name as string, input.namespace as string | undefined, input.version as string)) throw new EntityConflictError("Entity version already exists");
        dynamicModule(input as EntityDefinitionRecord, behaviors);
      },
      afterCreate(record) { runtime.install(dynamicModule(record as EntityDefinitionRecord, behaviors)); },
      beforeUpdate(current, next) {
        if (current.name !== next.name) throw new ValidationError("Entity name cannot be changed");
        if (current.version !== next.version) throw new ValidationError("Entity version cannot be changed");
        if (current.namespace !== next.namespace && runtime.hasExact(next.name as string, next.namespace as string | undefined, next.version as string)) {
          throw new EntityConflictError("Entity already exists");
        }
        dynamicModule(next as EntityDefinitionRecord, behaviors);
      },
      afterUpdate(previous, record) {
        runtime.replace(previous.name as string, dynamicModule(record as EntityDefinitionRecord, behaviors), previous.namespace as string | undefined);
      },
      afterDelete(record) { runtime.remove(record.name as string, record.namespace as string | undefined, record.version as string); }
    }
  };
}
