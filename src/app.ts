import type { IncomingMessage, ServerResponse } from "node:http";
import { EntityRuntime, type EntityModule } from "./application/entity-runtime";
import { createEntitiesModule, entityCatalogRecord, moduleFromRecord } from "./entities/entities";
import { systemDefinitionRecords } from "./entities/system-definitions";
import { bindSecurityLifecycle } from "./application/security";
import { authenticationMiddleware, authorizationMiddleware, compose, documentationMiddleware, entityLifecycleMiddleware, exensialQueryMiddleware, httpAdapterMiddleware, payloadPatternMiddleware, requestRepositoryMiddleware, responseRepositoryMiddleware, restPatternMiddleware, useCasesMiddleware, viewsMiddleware } from "./http/middleware";

export interface AppOptions {
  modules?: EntityModule[];
  enableEntityCatalog?: boolean;
  enableExensialQuery?: boolean;
  enableSecurity?: boolean;
  enableViews?: boolean;
  enableUseCases?: boolean;
}

/** Creates the HTTP app with the system entity and any code-defined entity modules. */
export function createApp({
  modules = [],
  enableEntityCatalog = process.env.EXENSIAL_ENABLE_ENTITY_CATALOG !== "false",
  enableExensialQuery = process.env.EXENSIAL_ENABLE_EXENSIAL_QUERY !== "false",
  enableSecurity = process.env.EXENSIAL_ENABLE_SECURITY !== "false",
  enableViews = process.env.EXENSIAL_ENABLE_VIEWS !== "false",
  enableUseCases = process.env.EXENSIAL_ENABLE_USE_CASES !== "false"
}: AppOptions = {}) {
  const runtime = new EntityRuntime();
  const binding = enableSecurity ? bindSecurityLifecycle : undefined;
  const systemRecords = systemDefinitionRecords.filter((record) => (enableSecurity || !["roles", "users", "userRoles", "permissions"].includes(record.name)) && (enableViews || !["views", "menus"].includes(record.name)) && (enableUseCases || record.name !== "useCases"));
  if (enableEntityCatalog) {
    runtime.install(createEntitiesModule(runtime, binding));
    runtime.seedRecord("entities", entityCatalogRecord);
    for (const record of systemRecords) {
      const persisted = runtime.seedRecord("entities", record);
      runtime.install(moduleFromRecord(persisted, binding));
    }
  } else {
    // Catalog-free mode keeps fixed startup modules but intentionally exposes no /entities route.
    for (const record of systemRecords) runtime.install(moduleFromRecord(record as unknown as import("./domain/entity").EntityDefinitionRecord, binding));
  }
  for (const module of modules) runtime.install(module);
  const handle = compose([
    httpAdapterMiddleware(),
    documentationMiddleware(runtime, { exensialQuery: enableExensialQuery, security: enableSecurity, views: enableViews }),
    authenticationMiddleware(runtime, enableSecurity),
    authorizationMiddleware(runtime, enableSecurity),
    useCasesMiddleware(runtime, enableUseCases),
    viewsMiddleware(runtime, enableViews),
    exensialQueryMiddleware(runtime, enableExensialQuery),
    restPatternMiddleware(runtime),
    responseRepositoryMiddleware(runtime),
    payloadPatternMiddleware(runtime),
    requestRepositoryMiddleware(runtime),
    entityLifecycleMiddleware(runtime)
  ]);

  return async (request: IncomingMessage, response: ServerResponse) => {
    await handle({ request, response });
  };
}
