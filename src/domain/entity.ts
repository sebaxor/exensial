export type ScalarType = "string" | "number" | "boolean" | "json";

export interface FieldDefinition {
  type: ScalarType;
  required: boolean;
}

export interface EntityDefinition {
  name: string;
  fields: Record<string, FieldDefinition>;
}

export type EntityRecord = Record<string, unknown> & { id: string };

export type EntityDefinitionRecord = EntityRecord & {
  name: string;
  definition: string;
};
