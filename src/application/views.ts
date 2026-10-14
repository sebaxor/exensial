import type { EntityDefinition, EntityRecord } from "../domain/entity";
import type { EntityRuntime } from "./entity-runtime";

export type ViewManifestEntry = {
  viewId: string;
  kind: "query" | "detail";
  name: string;
  source?: Record<string, unknown>;
  target?: { namespace?: string; entity: string; slot: "query" | "detail" };
  columns?: unknown;
  fields?: unknown;
  implicit: boolean;
};

export type MenuManifestEntry = {
  menuId: string;
  parentId?: string;
  position: number;
  visible: boolean;
  icon?: string;
  viewId: string;
};

/** Builds the read model consumed by the Views frontend layer. */
export function viewManifest(runtime: EntityRuntime, apiVersion = `v${runtime.latestMajor()}`): { views: ViewManifestEntry[]; menus: MenuManifestEntry[] } {
  const defaults = runtime.definitions(apiVersion).flatMap(defaultViews);
  const explicit = runtime.listRecords("views").map(viewRecord);
  const overrides = new Map(explicit.filter((view) => view.target).map((view) => [targetKey(view.target!), view]));
  const views = [...defaults.filter((view) => !overrides.has(targetKey(view.target!))), ...explicit];
  const defaultMenus = views.filter((view) => view.kind === "query" && view.implicit).map((view, position) => ({
    menuId: `menu:${view.viewId}`, position, visible: true, viewId: view.viewId
  }));
  const explicitMenus = runtime.listRecords("menus").map(menuRecord);
  const menuOverrides = new Map(explicitMenus.map((menu) => [menu.viewId, menu]));
  const menus = [...defaultMenus.filter((menu) => !menuOverrides.has(menu.viewId)), ...explicitMenus]
    .filter((menu) => views.some((view) => view.viewId === menu.viewId))
    .sort((left, right) => left.position - right.position || left.menuId.localeCompare(right.menuId));
  return { views, menus };
}

function defaultViews(definition: EntityDefinition): ViewManifestEntry[] {
  const namespace = definition.context?.namespace;
  const base = `entity:${namespace ? `${namespace}.` : ""}${definition.name}`;
  const target = { ...(namespace ? { namespace } : {}), entity: definition.name };
  return [
    { viewId: `${base}:query`, kind: "query", name: definition.name, target: { ...target, slot: "query" }, implicit: true },
    { viewId: `${base}:detail`, kind: "detail", name: definition.name, target: { ...target, slot: "detail" }, fields: Object.keys(definition.fields), implicit: true }
  ];
}

function viewRecord(record: EntityRecord): ViewManifestEntry {
  const target = object(record.target) as ViewManifestEntry["target"] | undefined;
  return {
    viewId: String(record.viewId), kind: record.kind === "detail" ? "detail" : "query", name: String(record.name),
    ...(object(record.source) ? { source: object(record.source) } : {}), ...(target ? { target } : {}),
    ...(record.columns === undefined ? {} : { columns: record.columns }), ...(record.fields === undefined ? {} : { fields: record.fields }), implicit: false
  };
}

function menuRecord(record: EntityRecord): MenuManifestEntry {
  return { menuId: String(record.menuId), ...(typeof record.parentId === "string" ? { parentId: record.parentId } : {}), position: Number(record.position ?? 0), visible: record.visible !== false, ...(typeof record.icon === "string" ? { icon: record.icon } : {}), viewId: String(record.viewId) };
}
function targetKey(target: NonNullable<ViewManifestEntry["target"]>): string { return `${target.namespace ?? ""}/${target.entity}/${target.slot}`; }
function object(value: unknown): Record<string, unknown> | undefined { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
