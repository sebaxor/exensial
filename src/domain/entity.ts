export type ScalarType = "string" | "number" | "boolean" | "json";

export type LocalizedText = Record<string, string>;

export interface Documentation {
  title?: LocalizedText;
  description?: LocalizedText;
  /** Localized OpenAPI summaries keyed by CRUD action, for example `list` or `update`. */
  operations?: Record<string, LocalizedText>;
}

export type UiControl = "text" | "textarea" | "email" | "password" | "date" | "datetime" | "number" | "money" | "checkbox";

export interface FieldUi {
  hidden?: boolean;
  /** Excluded from generic collection tables, while retained in forms and REST representations. */
  tableHidden?: boolean;
  /** Excluded from HTTP representations while remaining available to trusted server-side logic. */
  sensitive?: boolean;
  control?: UiControl;
  /** Allows text search operators in optional query capabilities. */
  searchable?: boolean;
  /** Allows equality and comparison filters in optional query capabilities. */
  filterable?: boolean;
  relation?: { entity: string; namespace?: string; label?: string };
}

export interface FieldDefinition {
  type: ScalarType;
  required: boolean;
  /** JSON-compatible value applied when this field is omitted on creation. */
  default?: unknown;
  documentation?: Documentation;
  ui?: FieldUi;
}

export interface EntityDefinition {
  name: string;
  fields: Record<string, FieldDefinition>;
  documentation?: Documentation;
  context?: { namespace?: string; version?: string; group?: string; icon?: string; code?: string; operations?: string[] };
}

export type EntityRecord = Record<string, unknown> & { id: string };

export type EntityDefinitionRecord = EntityRecord & {
  name: string;
  definition: string;
  namespace?: string;
  version: string;
  group?: string;
  icon?: string;
  code?: string;
};
