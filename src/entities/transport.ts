import type { EntityModule } from "../application/entity-runtime";

/** Audit entities are ordinary modules, so they receive the same REST CRUD as user entities. */
export const transportModules: EntityModule[] = [
  {
    definition: {
      name: "localizations",
      context: { version: "1.0.0", group: "System" },
      documentation: { title: { en: "Localization catalog" }, description: { en: "Runtime translations for OpenAPI metadata and the generic console." } },
      fields: {
        locale: { type: "string", required: true, documentation: { title: { en: "Language" } }, ui: { searchable: true, filterable: true } },
        key: { type: "string", required: true, documentation: { title: { en: "Translation key" }, description: { en: "For example entity.library.books.title or entity.library.books.field.title.title." } }, ui: { searchable: true, filterable: true } },
        value: { type: "string", required: true, documentation: { title: { en: "Translated text" } }, ui: { control: "textarea" } }
      }
    }
  },
  {
    definition: {
      name: "requests",
      context: { version: "1.0.0", group: "System" },
      documentation: { title: { en: "Request journal" }, description: { en: "Normalized inbound API requests captured for auditing and diagnostics." } },
      fields: {
        apiVersion: { type: "string", required: true, documentation: { title: { en: "API version" } } },
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
      context: { version: "1.0.0", group: "System" },
      documentation: { title: { en: "Response journal" }, description: { en: "Normalized API responses with completion time and duration." } },
      fields: {
        status: { type: "number", required: true },
        completedAt: { type: "string", required: true },
        durationMs: { type: "number", required: true },
        body: { type: "json", required: false }
      }
    }
  }
];
