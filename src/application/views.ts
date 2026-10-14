import type { EntityDefinition, EntityRecord } from "../domain/entity";
import type { EntityRuntime } from "./entity-runtime";
import { execute, type Parameters, type SelectQuery, type Tables } from "../../packages/exensialquery/src/index";
import { ValidationError } from "./entity-runtime";

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

/** Executes a persisted ExensialQuery QueryView through the active repository target. */
export function executeQueryView(runtime: EntityRuntime, viewId: string, parameters: Parameters = {}, apiVersion = `v${runtime.latestMajor()}`): { view: ViewManifestEntry; items: Record<string, unknown>[]; sources: EntityDefinition[] } {
  const view = viewManifest(runtime, apiVersion).views.find((item) => item.viewId === viewId);
  if (!view) throw new ValidationError("View not found");
  if (view.kind !== "query") throw new ValidationError("Only QueryViews can be executed");
  if (!view.source || view.source.language !== "exensialquery") throw new ValidationError("QueryView does not use the installed ExensialQuery language");
  const ast = view.source.ast;
  if (!isSelectQuery(ast)) throw new ValidationError("QueryView source must contain an ExensialQuery SelectQuery AST");
  const sources = querySources(ast).map((name) => resolveSource(runtime, name, apiVersion));
  const tables: Tables = {};
  for (const source of sources) tables[source.tableName] = publicRecords(runtime, source.definition);
  return { view, items: execute(ast, tables, parameters), sources: sources.map((source) => source.definition) };
}

export function queryViewSourcePaths(runtime: EntityRuntime, viewId: string, apiVersion = `v${runtime.latestMajor()}`): string[] {
  const view = viewManifest(runtime, apiVersion).views.find((item) => item.viewId === viewId);
  const ast = view?.source?.ast;
  if (!view || !ast || !isSelectQuery(ast)) return [];
  return querySources(ast).map((name) => resolveSource(runtime, name, apiVersion)).map(({ definition }) => `/v1/${definition.context?.namespace ? `${definition.context.namespace}/` : ""}${definition.name}`);
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

function isSelectQuery(value: unknown): value is SelectQuery { return Boolean(value && typeof value === "object" && (value as { type?: unknown }).type === "select" && Array.isArray((value as { select?: unknown }).select) && (value as { from?: { type?: unknown } }).from?.type === "table"); }
function querySources(query: SelectQuery): string[] {
  const direct = [query.from.name, ...(query.joins ?? []).map((join) => join.source.name)];
  return [...new Set([...direct, ...(query.with ?? []).flatMap((cte) => querySources(cte.query)), ...(query.union ?? []).flatMap((part) => querySources(part.query))])];
}
function resolveSource(runtime: EntityRuntime, tableName: string, apiVersion: string): { tableName: string; definition: EntityDefinition } {
  const definitions = runtime.definitions(apiVersion);
  const matches = definitions.filter((definition) => tableName === definition.name || tableName === `${definition.context?.namespace ?? ""}.${definition.name}`);
  if (matches.length !== 1) throw new ValidationError(`Query source is not an unambiguous entity: ${tableName}`);
  return { tableName, definition: matches[0] };
}
function publicRecords(runtime: EntityRuntime, definition: EntityDefinition): Record<string, unknown>[] {
  const sensitive = new Set(Object.entries(definition.fields).filter(([, field]) => field.ui?.sensitive).map(([name]) => name));
  return runtime.listRecords(definition.name, definition.context?.namespace).map((record) => Object.fromEntries(Object.entries(record).filter(([name]) => !sensitive.has(name))));
}
