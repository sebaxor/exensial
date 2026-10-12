import type { IncomingMessage, ServerResponse } from "node:http";
import { EntityRuntime, type EntityModule } from "./application/entity-runtime";
import { createEntitiesModule } from "./entities/entities";
import { transportModules } from "./entities/transport";
import { compose, entityLifecycleMiddleware, httpAdapterMiddleware, payloadPatternMiddleware, requestRepositoryMiddleware, responseRepositoryMiddleware, restPatternMiddleware } from "./http/middleware";

export interface AppOptions {
  modules?: EntityModule[];
}

/** Creates the HTTP app with the system entity and any code-defined entity modules. */
export function createApp({ modules = [] }: AppOptions = {}) {
  const runtime = new EntityRuntime();
  runtime.install(createEntitiesModule(runtime));
  for (const module of transportModules) runtime.install(module);
  for (const module of modules) runtime.install(module);
  const handle = compose([
    httpAdapterMiddleware(),
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
