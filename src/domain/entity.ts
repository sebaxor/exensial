export type ScalarType = "string" | "number" | "boolean" | "json";

export type LocalizedText = Record<string, string>;

export interface Documentation {
  title?: LocalizedText;
  description?: LocalizedText;
}

export type UiControl = "text" | "textarea" | "email" | "date" | "datetime" | "number" | "money" | "checkbox";

export interface FieldUi {
  hidden?: boolean;
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
  documentation?: Documentation;
  ui?: FieldUi;
}

export interface EntityDefinition {
  name: string;
  fields: Record<string, FieldDefinition>;
  documentation?: Documentation;
  context?: { namespace?: string; version?: string; group?: string; module?: string; behavior?: Record<string, unknown>; logic?: Record<string, unknown>; code?: string; operations?: string[] };
}

export type EntityRecord = Record<string, unknown> & { id: string };

export type EntityDefinitionRecord = EntityRecord & {
  name: string;
  definition: string;
  namespace?: string;
  version: string;
  group?: string;
  module?: string;
  behavior?: Record<string, unknown>;
  logic?: Record<string, unknown>;
  code?: string;
};
