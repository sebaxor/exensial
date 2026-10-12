import type { IncomingMessage, ServerResponse } from "node:http";
import { EntityRuntime, type EntityModule } from "./application/entity-runtime";
import { createEntitiesModule } from "./entities/entities";
import { compose, entityLifecycleMiddleware, errorMiddleware, payloadPatternMiddleware, restPatternMiddleware } from "./http/middleware";
import { sendJson } from "./http";

export interface AppOptions {
  modules?: EntityModule[];
}

/** Creates the HTTP app with the system entity and any code-defined entity modules. */
export function createApp({ modules = [] }: AppOptions = {}) {
  const runtime = new EntityRuntime();
  runtime.install(createEntitiesModule(runtime));
  for (const module of modules) runtime.install(module);
  const handle = compose([errorMiddleware(), restPatternMiddleware(runtime), payloadPatternMiddleware(runtime), entityLifecycleMiddleware(runtime)]);

  return async (request: IncomingMessage, response: ServerResponse) => {
    try {
      await handle({ request, response });
    } catch {
      return sendJson(response, 500, { error: "Internal server error" });
    }
  };
}
