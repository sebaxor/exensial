import type { EntityModule } from "../application/entity-runtime";

/** Audit entities are ordinary modules, so they receive the same REST CRUD as user entities. */
export const transportModules: EntityModule[] = [
  {
    definition: {
      name: "requests",
      fields: {
        apiVersion: { type: "string", required: true },
        receivedAt: { type: "string", required: true },
        namespace: { type: "string", required: false },
        entityName: { type: "string", required: true },
        action: { type: "string", required: true },
        id: { type: "string", required: false },
        payload: { type: "json", required: false }
      }
    }
  },
  {
    definition: {
      name: "responses",
      fields: {
        status: { type: "number", required: true },
        completedAt: { type: "string", required: true },
        durationMs: { type: "number", required: true },
        body: { type: "json", required: false }
      }
    }
  }
];
