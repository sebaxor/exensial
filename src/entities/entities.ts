import type { EntityDefinitionRecord } from "../domain/entity";
import { parseEntitySource, ValidationError } from "../domain/schema";
import { EntityConflictError, type EntityModule, type EntityRuntime } from "../application/entity-runtime";
import { compileRuntimeCode } from "../application/runtime-code";

export type ModuleBinding = (record: EntityDefinitionRecord, module: EntityModule) => EntityModule;

/** The one bootstrapping schema that lets the catalog describe itself. */
export const entityCatalogSource = String.raw`/**
 * @exensial.title en Entity catalog
 * @exensial.title es Catálogo de entidades
 * @exensial.description en Creates, updates, and removes runtime REST entities from TypeScript type aliases.
 * @exensial.description es Crea, actualiza y elimina entidades REST en tiempo de ejecución desde alias de tipo TypeScript.
 */
type EntityCatalog = {
  /** @exensial.title en Route name
   * @exensial.title es Nombre de ruta
   * @exensial.description en Final route segment. With namespace library, books becomes /v1/library/books.
   * @exensial.description es Segmento final de ruta. Con el espacio de nombres library, books se convierte en /v1/library/books. */
  name: string;
  /** @exensial.title en Entity version
   * @exensial.title es Versión de entidad */
  version?: string;
  /** @exensial.title en TypeScript type
   * @exensial.title es Tipo TypeScript
   * @exensial.ui.control textarea
   * @exensial.ui.code typescript
   * @exensial.ui.tableHidden */
  definition: string;
  /** @exensial.title en Namespace
   * @exensial.title es Espacio de nombres */
  namespace?: string;
  /** @exensial.title en Console menu group
   * @exensial.title es Grupo del menú */
  group?: string;
  /** @exensial.title en Console icon
   * @exensial.title es Ícono del menú */
  icon?: string;
  /** @exensial.title en Runtime TypeScript domain module
   * @exensial.title es Módulo de dominio TypeScript
   * @exensial.ui.control textarea
   * @exensial.ui.code typescript
   * @exensial.ui.tableHidden */
  code?: string;
}`;

export const entityCatalogRecord: { name: string; version: string; group: string; icon: string; definition: string } = {
  name: "entities", version: "1.0.0", group: "System", icon: "database,🗂", definition: entityCatalogSource
};

/** Converts a catalog record into the same generic module used for user-created entities. */
export function moduleFromRecord(record: EntityDefinitionRecord, binding?: ModuleBinding): EntityModule {
  const parsed = parseEntitySource(record.definition);
  const code = compileRuntimeCode(record.code);
  const module: EntityModule = {
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
  return binding ? binding(record, module) : module;
}

/**
 * The catalog is a regular CRUD entity plus the minimal lifecycle that turns
 * its records into active modules. It is also represented by entityCatalogRecord.
 */
export function createEntitiesModule(runtime: EntityRuntime, binding?: ModuleBinding): EntityModule {
  return catalogModule(runtime, entityCatalogRecord as EntityDefinitionRecord, binding);
}

function catalogModule(runtime: EntityRuntime, record: EntityDefinitionRecord, binding?: ModuleBinding): EntityModule {
  const catalog = moduleFromRecord(record, binding);
  return {
    ...catalog,
    lifecycle: {
      beforeCreate(input) {
        const candidate = input as EntityDefinitionRecord;
        if (runtime.hasExact(candidate.name, candidate.namespace, candidate.version)) throw new EntityConflictError("Entity version already exists");
        moduleFromRecord(candidate, binding);
      },
      afterCreate(record) { runtime.install(installedModule(runtime, record as EntityDefinitionRecord, binding)); },
      beforeUpdate(current, next) {
        if (current.name !== next.name) throw new ValidationError("Entity name cannot be changed");
        if (current.version !== next.version) throw new ValidationError("Entity version cannot be changed");
        if (current.namespace !== next.namespace && runtime.hasExact(next.name as string, next.namespace as string | undefined, next.version as string)) {
          throw new EntityConflictError("Entity already exists");
        }
        moduleFromRecord(next as EntityDefinitionRecord, binding);
      },
      afterUpdate(previous, record) {
        runtime.replace(previous.name as string, installedModule(runtime, record as EntityDefinitionRecord, binding), previous.namespace as string | undefined);
      },
      afterDelete(record) { runtime.remove(record.name as string, record.namespace as string | undefined, record.version as string); }
    }
  };
}

function installedModule(runtime: EntityRuntime, record: EntityDefinitionRecord, binding?: ModuleBinding): EntityModule {
  return record.name === "entities" && !record.namespace ? catalogModule(runtime, record, binding) : moduleFromRecord(record, binding);
}
