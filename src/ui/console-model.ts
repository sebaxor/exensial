/**
 * Framework-free state transformations used by the Exensial console.
 *
 * This module deliberately has no DOM or HTTP dependency. The browser console
 * imports its transpiled form and the Node test suite imports this source.
 */
export type Relation = { entity: string; namespace?: string };
export type ConsoleResource = {
  key: string;
  name: string;
  path: string;
  entityPath?: string;
  schema: Record<string, unknown>;
  operations: Record<string, unknown>;
  itemOperations: Record<string, unknown>;
  group: string;
  icon?: string;
  menuPosition?: number;
  fields: Array<[string, Record<string, unknown>]>;
  view?: Record<string, unknown>;
};

type Operation = Record<string, unknown> & { tags?: string[] };
type OpenApiDocument = { components: { schemas: Record<string, Record<string, unknown>> }; paths: Record<string, Record<string, Operation | undefined>> };
type Menu = { viewId: string; parentId?: string; icon?: string; position?: number; visible?: boolean };
type View = { viewId: string; name: string; kind: string; implicit?: boolean; target?: { namespace?: string; entity?: string; slot?: string } };

export function entityPath(relation: Relation): string {
  return `/v1/${relation.namespace ? `${relation.namespace}/` : ""}${relation.entity}`;
}

export function createConsoleResources(document: OpenApiDocument, allowed: (operation: Record<string, unknown> | undefined) => boolean): ConsoleResource[] {
  return Object.entries(document.components.schemas).flatMap(([key, schema]) => {
    const entry = Object.entries(document.paths).find(([path, item]) => !path.includes("{id}") && Array.isArray(item.get?.tags) && item.get.tags.includes(key));
    if (!entry || !allowed(entry[1].get)) return [];
    const [path, operations] = entry;
    const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
    const context = (schema["x-exensial-context"] ?? {}) as { group?: string; icon?: string };
    return [{ key, name: String(schema.title ?? key), path, schema, operations, itemOperations: document.paths[`${path}/{id}`] ?? {}, group: context.group ?? "General", icon: context.icon, fields: Object.entries(properties).filter(([name]) => name !== "id") }];
  });
}

/** Finds an entity resource even when its list UI has been replaced by a QueryView. */
export function findRelationResource(resources: ConsoleResource[], relation: Relation): ConsoleResource | undefined {
  const path = entityPath(relation);
  return resources.find((resource) => (resource.entityPath ?? resource.path) === path);
}

/** Returns the CRUD collection endpoint used for selectors and relationship data. */
export function relationCollectionPath(resource: ConsoleResource, pageSize = 25): string {
  return `${resource.entityPath ?? resource.path}?page=1&perPage=${pageSize}`;
}

/** Merges persisted menu/view configuration over generated CRUD navigation. */
export function mergeViewManifest(resources: ConsoleResource[], manifest: { views: View[]; menus?: Menu[] }): ConsoleResource[] {
  const next = [...resources];
  const views = new Map(manifest.views.map((view) => [view.viewId, view]));
  const defaults = new Map(next.map((resource) => [`entity:${resource.path.slice("/v1/".length).replace("/", ".")}:query`, resource]));
  for (const menu of manifest.menus ?? []) {
    const view = views.get(menu.viewId);
    const defaultResource = defaults.get(menu.viewId);
    if (defaultResource) {
      if (menu.visible === false) { next.splice(next.indexOf(defaultResource), 1); continue; }
      defaultResource.group = menu.parentId ?? defaultResource.group;
      defaultResource.icon = menu.icon ?? defaultResource.icon;
      defaultResource.menuPosition = menu.position;
      continue;
    }
    if (!view || view.implicit || view.kind !== "query" || menu.visible === false) continue;
    const target = view.target?.slot === "query" && view.target.entity ? next.find((resource) => resource.path === entityPath({ entity: view.target!.entity!, namespace: view.target!.namespace })) : undefined;
    if (target) {
      target.name = view.name;
      target.entityPath ??= target.path;
      target.path = `/v1/views/${encodeURIComponent(view.viewId)}/data`;
      target.view = view;
      target.group = menu.parentId ?? target.group;
      target.icon = menu.icon ?? target.icon;
      target.menuPosition = menu.position;
      continue;
    }
    next.push({ key: `view:${view.viewId}`, name: view.name, path: `/v1/views/${encodeURIComponent(view.viewId)}/data`, schema: {}, operations: {}, itemOperations: {}, group: menu.parentId ?? "General", icon: menu.icon, menuPosition: menu.position, fields: [], view });
  }
  return next;
}
