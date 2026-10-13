import type { EntityModule } from "../application/entity-runtime";

/** Audit entities are ordinary modules, so they receive the same REST CRUD as user entities. */
export const transportModules: EntityModule[] = [
  {
    definition: {
      name: "localizations",
      context: { version: "1.0.0", group: "System" },
      documentation: { title: { en: "Localization catalog", es: "Catálogo de localizaciones" }, description: { en: "Runtime translations for OpenAPI metadata and the generic console.", es: "Traducciones en tiempo de ejecución para los metadatos OpenAPI y la consola genérica." } },
      fields: {
        locale: { type: "string", required: true, documentation: { title: { en: "Language", es: "Idioma" } }, ui: { searchable: true, filterable: true } },
        key: { type: "string", required: true, documentation: { title: { en: "Translation key", es: "Clave de traducción" }, description: { en: "For example entity.library.books.title or entity.library.books.field.title.title.", es: "Por ejemplo entity.library.books.title o entity.library.books.field.title.title." } }, ui: { searchable: true, filterable: true } },
        value: { type: "string", required: true, documentation: { title: { en: "Translated text", es: "Texto traducido" } }, ui: { control: "textarea" } }
      }
    }
  },
  {
    definition: {
      name: "requests",
      context: { version: "1.0.0", group: "System" },
      documentation: { title: { en: "Request journal", es: "Registro de solicitudes" }, description: { en: "Normalized inbound API requests captured for auditing and diagnostics.", es: "Solicitudes de API entrantes normalizadas, capturadas para auditoría y diagnóstico." } },
      fields: {
        apiVersion: { type: "string", required: true, documentation: { title: { en: "API version", es: "Versión de API" } } },
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
      documentation: { title: { en: "Response journal", es: "Registro de respuestas" }, description: { en: "Normalized API responses with completion time and duration.", es: "Respuestas de API normalizadas con hora de finalización y duración." } },
      fields: {
        status: { type: "number", required: true },
        completedAt: { type: "string", required: true },
        durationMs: { type: "number", required: true },
        body: { type: "json", required: false }
      }
    }
  }
];
