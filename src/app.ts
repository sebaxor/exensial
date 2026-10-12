import type { IncomingMessage, ServerResponse } from "node:http";
import { EntityRuntime, type EntityModule } from "./application/entity-runtime";
import { EntityBehaviorRegistry, type EntityBehaviorModule } from "./application/entity-behaviors";
import { createEntitiesModule } from "./entities/entities";
import { transportModules } from "./entities/transport";
import { compose, documentationMiddleware, entityLifecycleMiddleware, httpAdapterMiddleware, payloadPatternMiddleware, requestRepositoryMiddleware, responseRepositoryMiddleware, restPatternMiddleware } from "./http/middleware";

export interface AppOptions {
  modules?: EntityModule[];
  behaviorModules?: EntityBehaviorModule[];
  enableEntityCatalog?: boolean;
}

/** Creates the HTTP app with the system entity and any code-defined entity modules. */
export function createApp({
  modules = [],
  behaviorModules = [],
  enableEntityCatalog = process.env.EXENSIAL_ENABLE_ENTITY_CATALOG !== "false"
}: AppOptions = {}) {
  const runtime = new EntityRuntime();
  const behaviors = new EntityBehaviorRegistry();
  for (const behavior of behaviorModules) behaviors.register(behavior);
  for (const module of transportModules) runtime.installIfMissing(module);
  if (enableEntityCatalog) runtime.installIfMissing(createEntitiesModule(runtime, behaviors));
  for (const module of modules) runtime.install(module);
  const handle = compose([
    httpAdapterMiddleware(),
    documentationMiddleware(runtime),
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
