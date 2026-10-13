import type { EntityDefinitionRecord } from "../domain/entity";
import { parseEntitySource, ValidationError } from "../domain/schema";
import { EntityConflictError, type EntityModule, type EntityRuntime } from "../application/entity-runtime";
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
    definition: { type: "string", required: true, documentation: { title: { en: "TypeScript type" }, description: { en: "The entity type alias and its Exensial JSDoc metadata." } }, ui: { control: "textarea", tableHidden: true } },
    namespace: { type: "string", required: false, documentation: { title: { en: "Namespace" }, description: { en: "Optional route segment before the route name; it scopes an entity without replacing its name." } } },
    group: { type: "string", required: false, documentation: { title: { en: "Console menu group" }, description: { en: "Presentation-only group in the generic console; it does not affect the REST route." } } },
    icon: { type: "string", required: false, documentation: { title: { en: "Console icon" }, description: { en: "Optional comma-separated icon fallbacks. The Console uses the first supported-looking value, for example book,📚." } } },
    code: { type: "string", required: false, documentation: { title: { en: "Runtime TypeScript domain module" }, description: { en: "Optional high-level domain module. This source is intentionally multi-line." } }, ui: { control: "textarea", tableHidden: true } }
  }
} satisfies EntityModule["definition"];

function dynamicModule(record: EntityDefinitionRecord): EntityModule {
  const parsed = parseEntitySource(record.definition);
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
        icon: record.icon,
        code: record.code,
        operations: Object.keys(code ?? {})
      }
    },
    operations: code
  };
}

/** System entity: each record deploys a regular dynamic entity. */
export function createEntitiesModule(runtime: EntityRuntime): EntityModule {
  return {
    definition,
    lifecycle: {
      beforeCreate(input) {
        if (runtime.hasExact(input.name as string, input.namespace as string | undefined, input.version as string)) throw new EntityConflictError("Entity version already exists");
        dynamicModule(input as EntityDefinitionRecord);
      },
      afterCreate(record) { runtime.install(dynamicModule(record as EntityDefinitionRecord)); },
      beforeUpdate(current, next) {
        if (current.name !== next.name) throw new ValidationError("Entity name cannot be changed");
        if (current.version !== next.version) throw new ValidationError("Entity version cannot be changed");
        if (current.namespace !== next.namespace && runtime.hasExact(next.name as string, next.namespace as string | undefined, next.version as string)) {
          throw new EntityConflictError("Entity already exists");
        }
        dynamicModule(next as EntityDefinitionRecord);
      },
      afterUpdate(previous, record) {
        runtime.replace(previous.name as string, dynamicModule(record as EntityDefinitionRecord), previous.namespace as string | undefined);
      },
      afterDelete(record) { runtime.remove(record.name as string, record.namespace as string | undefined, record.version as string); }
    }
  };
}
