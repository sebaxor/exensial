import type { EntityOperationMiddleware } from "./entity-runtime";
import type { DomainRequest } from "../domain/request";

export interface EntityBehaviorModule {
  id: string;
  operations: Partial<Record<DomainRequest["action"], EntityOperationMiddleware | EntityOperationMiddleware[]>>;
}

/** Trusted behavior modules are registered by application code, never uploaded over HTTP. */
export class EntityBehaviorRegistry {
  private readonly modules = new Map<string, EntityBehaviorModule>();

  register(module: EntityBehaviorModule): void {
    if (this.modules.has(module.id)) throw new Error(`Behavior module already registered: ${module.id}`);
    this.modules.set(module.id, module);
  }

  get(id: string): EntityBehaviorModule | undefined {
    return this.modules.get(id);
  }
}
