export type CrudAction = "create" | "bulkCreate" | "list" | "get" | "replace" | "update" | "delete";

export type PayloadPattern =
  | { kind: "one"; value: unknown }
  | { kind: "many"; values: unknown[] };

/** A transport-neutral REST request after URL and body-pattern capture. */
export interface DomainRequest {
  apiVersion: string;
  entityName: string;
  action: CrudAction;
  id?: string;
  payload?: PayloadPattern;
}
