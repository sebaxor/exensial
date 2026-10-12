import type { EntityModule } from "../application/entity-runtime";

/** Audit entities are ordinary modules, so they receive the same REST CRUD as user entities. */
export const transportModules: EntityModule[] = [
  {
    definition: {
      name: "requests",
      fields: {
        apiVersion: { type: "string", required: true },
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
        requestId: { type: "string", required: false },
        status: { type: "number", required: true },
        body: { type: "json", required: false }
      }
    }
  }
];
