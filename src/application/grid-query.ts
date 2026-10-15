import { execute, type Expression, type SelectQuery } from "../../packages/exensialquery/src/index";

/** A UI-neutral, serializable query state applied after a View's domain AST. */
export type GridQuery = {
  filters?: Array<{ field: string; operator: "contains" | "startsWith" | "endsWith" | "eq" | "ne" | "gt" | "gte" | "lt" | "lte"; value: string | number | boolean | null }>;
  orderBy?: Array<{ field: string; direction?: "ASC" | "DESC" }>;
  groupBy?: string[];
  aggregates?: Array<{ field?: string; function: "COUNT" | "SUM" | "AVG" | "MIN" | "MAX"; alias: string }>;
  page?: { number: number; size: number };
};

export type GridResult = { items: Record<string, unknown>[]; total: number };

/**
 * Executes GridQuery against all rows produced by a domain View. Pagination is
 * deliberately last: filters, grouping, aggregation, and sorting never run
 * against a browser page.
 */
export function executeGridQuery(rows: Record<string, unknown>[], grid: GridQuery = {}): GridResult {
  const where = join(grid.filters?.map(filterExpression).filter(Boolean) as Expression[] ?? []);
  const groups = grid.groupBy ?? [];
  const aggregates = grid.aggregates ?? [];
  const select = groups.length || aggregates.length
    ? [...groups.map(name => ({ expression: column(name) })), ...aggregates.map(aggregate => ({ expression: { type: "call", name: aggregate.function, arguments: aggregate.function === "COUNT" && !aggregate.field ? [{ type: "star" }] : [column(aggregate.field ?? "")] } as Expression, alias: aggregate.alias }))]
    : [{ expression: { type: "star" } as Expression }];
  const query: SelectQuery = {
    type: "select", from: { type: "table", name: "result" }, select,
    ...(where ? { where } : {}), ...(groups.length ? { groupBy: groups.map(column) } : {}),
    ...(grid.orderBy?.length ? { orderBy: grid.orderBy.map(item => ({ expression: column(item.field), direction: item.direction ?? "ASC" })) } : {})
  };
  const matching = execute(query, { result: rows });
  const size = Math.min(100, Math.max(1, grid.page?.size ?? 25)), number = Math.max(1, grid.page?.number ?? 1);
  return { total: matching.length, items: matching.slice((number - 1) * size, number * size) };
}

function column(name: string): Expression { return { type: "column", name }; }
function join(expressions: Expression[]): Expression | undefined { return expressions.reduce<Expression | undefined>((left, right) => left ? { type: "binary", operator: "AND", left, right } : right, undefined); }
function filterExpression(filter: NonNullable<GridQuery["filters"]>[number]): Expression {
  const left = column(filter.field), value = { type: "literal", value: filter.value } as Expression;
  if (filter.operator === "contains") return { type: "binary", operator: "LIKE", left, right: { type: "literal", value: `%${filter.value}%` } };
  if (filter.operator === "startsWith") return { type: "binary", operator: "LIKE", left, right: { type: "literal", value: `${filter.value}%` } };
  if (filter.operator === "endsWith") return { type: "binary", operator: "LIKE", left, right: { type: "literal", value: `%${filter.value}` } };
  const operator = ({ eq: "=", ne: "!=", gt: ">", gte: ">=", lt: "<", lte: "<=" } as const)[filter.operator];
  return { type: "binary", operator, left, right: value };
}
