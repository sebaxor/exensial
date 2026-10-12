export type ScalarType = "string" | "number" | "boolean" | "json";

export type LocalizedText = Record<string, string>;

export interface Documentation {
  title?: LocalizedText;
  description?: LocalizedText;
}

export interface FieldDefinition {
  type: ScalarType;
  required: boolean;
  documentation?: Documentation;
}

export interface EntityDefinition {
  name: string;
  fields: Record<string, FieldDefinition>;
  documentation?: Documentation;
}

export type EntityRecord = Record<string, unknown> & { id: string };

export type EntityDefinitionRecord = EntityRecord & {
  name: string;
  definition: string;
};
