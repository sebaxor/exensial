/**
 * ExensialQuery is a portable, read-only SQL subset. It deliberately owns a
 * small canonical AST so the same query runs in browsers, Node services, or a
 * future repository adapter without accepting arbitrary JavaScript.
 */
export type Scalar = string | number | boolean | null;
export type Expression =
  | { type: "literal"; value: Scalar }
  | { type: "parameter"; name: string }
  | { type: "column"; name: string; table?: string }
  | { type: "star" }
  | { type: "unary"; operator: "NOT" | "-"; expression: Expression }
  | { type: "binary"; operator: "=" | "<>" | "!=" | "<" | "<=" | ">" | ">=" | "+" | "-" | "*" | "/" | "AND" | "OR" | "LIKE" | "IN" | "IS" | "IS NOT"; left: Expression; right: Expression | Expression[] }
  | { type: "call"; name: "COUNT" | "SUM" | "AVG" | "MIN" | "MAX" | "LOWER" | "UPPER" | "COALESCE"; arguments: Expression[] };

export type SelectItem = { expression: Expression; alias?: string };
export type Source = { type: "table"; name: string; alias?: string };
export type Join = { type: "INNER" | "LEFT" | "RIGHT" | "FULL" | "CROSS"; source: Source; on?: Expression };
export type Order = { expression: Expression; direction?: "ASC" | "DESC" };
export type Cte = { name: string; query: SelectQuery };
export type SelectQuery = {
  type: "select";
  with?: Cte[];
  distinct?: boolean;
  select: SelectItem[];
  from: Source;
  joins?: Join[];
  where?: Expression;
  groupBy?: Expression[];
  having?: Expression;
  orderBy?: Order[];
  limit?: number;
  offset?: number;
  union?: Array<{ all?: boolean; query: SelectQuery }>;
};

export type Table = ReadonlyArray<Record<string, unknown>>;
export type Tables = Record<string, Table>;
export type Parameters = Record<string, Scalar>;

export const column = (name: string, table?: string): Expression => ({ type: "column", name, table });
export const literal = (value: Scalar): Expression => ({ type: "literal", value });
export const parameter = (name: string): Expression => ({ type: "parameter", name });
export const call = (name: "COUNT" | "SUM" | "AVG" | "MIN" | "MAX" | "LOWER" | "UPPER" | "COALESCE", ...arguments_: Expression[]): Expression => ({ type: "call", name, arguments: arguments_ });
export const binary = (operator: Extract<Expression, { type: "binary" }>["operator"], left: Expression, right: Expression | Expression[]): Expression => ({ type: "binary", operator, left, right });
export const and = (...expressions: Expression[]): Expression => expressions.reduce((left, right) => binary("AND", left, right));
export const or = (...expressions: Expression[]): Expression => expressions.reduce((left, right) => binary("OR", left, right));

/** JavaScript-native, serializable query builder: JS -> AST -> SQL. */
export function select(...items: Array<SelectItem | Expression | "*">): QueryBuilder {
  return new QueryBuilder({ type: "select", select: items.map(item => item === "*" ? { expression: { type: "star" } } : "type" in item ? { expression: item } : item), from: { type: "table", name: "" } });
}

export class QueryBuilder {
  constructor(private readonly ast: SelectQuery) {}
  from(name: string, alias?: string): QueryBuilder { return this.with({ from: { type: "table", name, alias } }); }
  join(name: string, on: Expression, alias?: string): QueryBuilder { return this.addJoin("INNER", name, on, alias); }
  leftJoin(name: string, on: Expression, alias?: string): QueryBuilder { return this.addJoin("LEFT", name, on, alias); }
  rightJoin(name: string, on: Expression, alias?: string): QueryBuilder { return this.addJoin("RIGHT", name, on, alias); }
  where(expression: Expression): QueryBuilder { return this.with({ where: expression }); }
  groupBy(...expressions: Expression[]): QueryBuilder { return this.with({ groupBy: expressions }); }
  having(expression: Expression): QueryBuilder { return this.with({ having: expression }); }
  orderBy(expression: Expression, direction: "ASC" | "DESC" = "ASC"): QueryBuilder { return this.with({ orderBy: [...(this.ast.orderBy ?? []), { expression, direction }] }); }
  limit(limit: number, offset?: number): QueryBuilder { return this.with({ limit, ...(offset === undefined ? {} : { offset }) }); }
  distinct(): QueryBuilder { return this.with({ distinct: true }); }
  toAst(): SelectQuery { return structuredClone(this.ast); }
  toSql(): string { return toSql(this.ast); }
  execute(tables: Tables, parameters?: Parameters): Record<string, unknown>[] { return execute(this.ast, tables, parameters); }
  private addJoin(type: Join["type"], name: string, on: Expression, alias?: string): QueryBuilder { return this.with({ joins: [...(this.ast.joins ?? []), { type, source: { type: "table", name, alias }, on }] }); }
  private with(change: Partial<SelectQuery>): QueryBuilder { return new QueryBuilder({ ...this.ast, ...change }); }
}

type Token = { value: string; kind: "word" | "string" | "number" | "parameter" | "operator" | "punctuation" };
const keywords = new Set(["WITH", "AS", "SELECT", "DISTINCT", "FROM", "INNER", "LEFT", "RIGHT", "FULL", "OUTER", "CROSS", "JOIN", "ON", "WHERE", "GROUP", "BY", "HAVING", "ORDER", "ASC", "DESC", "LIMIT", "OFFSET", "UNION", "ALL", "AND", "OR", "NOT", "IN", "IS", "NULL", "LIKE"]);

/** Parses the portable SELECT subset into ExensialQuery's AST. */
export function parse(sql: string): SelectQuery {
  const parser = new SqlParser(tokenize(sql));
  const query = parser.query();
  parser.end();
  return query;
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = []; let index = 0;
  while (index < input.length) {
    const rest = input.slice(index);
    const whitespace = /^\s+/.exec(rest); if (whitespace) { index += whitespace[0].length; continue; }
    const string = /^'(?:''|[^'])*'/.exec(rest); if (string) { tokens.push({ kind: "string", value: string[0].slice(1, -1).replace(/''/g, "'") }); index += string[0].length; continue; }
    const parameter_ = /^@[A-Za-z_][\w]*/.exec(rest); if (parameter_) { tokens.push({ kind: "parameter", value: parameter_[0].slice(1) }); index += parameter_[0].length; continue; }
    const number = /^\d+(?:\.\d+)?/.exec(rest); if (number) { tokens.push({ kind: "number", value: number[0] }); index += number[0].length; continue; }
    const word = /^[A-Za-z_][\w$]*/.exec(rest); if (word) { tokens.push({ kind: "word", value: word[0] }); index += word[0].length; continue; }
    const operator = /^(<=|>=|<>|!=|=|<|>|\+|-|\/)/.exec(rest); if (operator) { tokens.push({ kind: "operator", value: operator[0] }); index += operator[0].length; continue; }
    if ("(),.*;".includes(rest[0])) { tokens.push({ kind: "punctuation", value: rest[0] }); index++; continue; }
    throw new SyntaxError(`Unexpected SQL character: ${rest[0]}`);
  }
  return tokens;
}

class SqlParser {
  private position = 0;
  constructor(private readonly tokens: Token[]) {}
  query(): SelectQuery {
    const with_ = this.matchWord("WITH") ? this.ctes() : undefined;
    const root = this.select(); if (with_) root.with = with_;
    while (this.matchWord("UNION")) {
      const all = this.matchWord("ALL");
      const union = this.select();
      // SQL ORDER/LIMIT after a UNION applies to the compound result, not only
      // to its final SELECT. Keep it on the root canonical query.
      if (union.orderBy) { root.orderBy = union.orderBy; delete union.orderBy; }
      if (union.limit !== undefined) { root.limit = union.limit; delete union.limit; }
      if (union.offset !== undefined) { root.offset = union.offset; delete union.offset; }
      root.union = [...(root.union ?? []), { all, query: union }];
    }
    return root;
  }
  private ctes(): Cte[] { const values: Cte[] = []; do { const name = this.word(); this.expectWord("AS"); this.expect("("); const query = this.query(); this.expect(")"); values.push({ name, query }); } while (this.match(",")); return values; }
  private select(): SelectQuery {
    this.expectWord("SELECT"); const distinct = this.matchWord("DISTINCT"); const select = this.selectList(); this.expectWord("FROM");
    const from = this.source(); const joins: Join[] = [];
    while (this.isJoin()) joins.push(this.join());
    const where = this.matchWord("WHERE") ? this.expression() : undefined;
    let groupBy: Expression[] | undefined; if (this.matchWord("GROUP")) { this.expectWord("BY"); groupBy = this.expressionList(); }
    const having = this.matchWord("HAVING") ? this.expression() : undefined;
    let orderBy: Order[] | undefined; if (this.matchWord("ORDER")) { this.expectWord("BY"); orderBy = this.orderList(); }
    let limit: number | undefined; let offset: number | undefined;
    if (this.matchWord("LIMIT")) { limit = this.number(); if (this.matchWord("OFFSET")) offset = this.number(); }
    else if (this.matchWord("OFFSET")) { offset = this.number(); this.expectWord("LIMIT"); limit = this.number(); }
    return { type: "select", ...(distinct ? { distinct: true } : {}), select, from, ...(joins.length ? { joins } : {}), ...(where ? { where } : {}), ...(groupBy ? { groupBy } : {}), ...(having ? { having } : {}), ...(orderBy ? { orderBy } : {}), ...(limit === undefined ? {} : { limit }), ...(offset === undefined ? {} : { offset }) };
  }
  private selectList(): SelectItem[] { const values: SelectItem[] = []; do { const expression = this.match("*") ? { type: "star" } as Expression : this.expression(); let alias: string | undefined; if (this.matchWord("AS")) alias = this.word(); else if (this.peek()?.kind === "word" && !keywords.has(this.peek()!.value.toUpperCase())) alias = this.word(); values.push({ expression, ...(alias ? { alias } : {}) }); } while (this.match(",")); return values; }
  private source(): Source { const name = this.word(); const alias = this.alias(); return { type: "table", name, ...(alias ? { alias } : {}) }; }
  private alias(): string | undefined { if (this.matchWord("AS")) return this.word(); return this.peek()?.kind === "word" && !keywords.has(this.peek()!.value.toUpperCase()) ? this.word() : undefined; }
  private isJoin(): boolean { return ["JOIN", "INNER", "LEFT", "RIGHT", "FULL", "CROSS"].includes(this.peek()?.value.toUpperCase() ?? ""); }
  private join(): Join { let type: Join["type"] = "INNER"; if (!this.matchWord("JOIN")) { type = this.word().toUpperCase() as Join["type"]; this.matchWord("OUTER"); this.expectWord("JOIN"); } const source = this.source(); const on = type === "CROSS" ? undefined : (this.expectWord("ON"), this.expression()); return { type, source, ...(on ? { on } : {}) }; }
  private orderList(): Order[] { const result: Order[] = []; do { const expression = this.expression(); const direction = this.matchWord("ASC") ? "ASC" : this.matchWord("DESC") ? "DESC" : undefined; result.push({ expression, ...(direction ? { direction } : {}) }); } while (this.match(",")); return result; }
  private expressionList(): Expression[] { const result: Expression[] = []; do result.push(this.expression()); while (this.match(",")); return result; }
  private expression(min = 0): Expression {
    let left = this.prefix(); const precedence: Record<string, number> = { OR: 1, AND: 2, "=": 3, "<>": 3, "!=": 3, "<": 3, "<=": 3, ">": 3, ">=": 3, LIKE: 3, IN: 3, IS: 3, "+": 4, "-": 4, "*": 5, "/": 5 };
    for (;;) { let operator = this.peek()?.value.toUpperCase() ?? ""; if (operator === "IS" && this.peek(1)?.value.toUpperCase() === "NOT") operator = "IS NOT"; const rank = precedence[operator]; if (!rank || rank < min) break; this.position += operator === "IS NOT" ? 2 : 1; let right: Expression | Expression[]; if (operator === "IN") { this.expect("("); right = this.expressionList(); this.expect(")"); } else if (operator === "IS" || operator === "IS NOT") { this.expectWord("NULL"); right = literal(null); } else right = this.expression(rank + 1); left = binary(operator as Extract<Expression, { type: "binary" }>["operator"], left, right); }
    return left;
  }
  private prefix(): Expression { if (this.matchWord("NOT")) return { type: "unary", operator: "NOT", expression: this.expression(6) }; if (this.match("-")) return { type: "unary", operator: "-", expression: this.expression(6) }; if (this.match("(")) { const value = this.expression(); this.expect(")"); return value; } const token = this.next(); if (!token) throw new SyntaxError("Expected expression"); if (token.kind === "string") return literal(token.value); if (token.kind === "number") return literal(Number(token.value)); if (token.kind === "parameter") return parameter(token.value); if (token.kind !== "word") throw new SyntaxError(`Unexpected token ${token.value}`); if (token.value.toUpperCase() === "NULL") return literal(null); if (this.match("(")) { const arguments_ = this.match("*") ? [{ type: "star" } as Expression] : this.match(")") ? [] : this.expressionList(); if (arguments_.length && !this.previousIs(")")) this.expect(")"); return { type: "call", name: token.value.toUpperCase() as Extract<Expression, { type: "call" }>["name"], arguments: arguments_ }; } if (this.match(".")) return column(this.word(), token.value); return column(token.value); }
  private previousIs(value: string): boolean { return this.tokens[this.position - 1]?.value === value; }
  private word(): string { const token = this.next(); if (!token || token.kind !== "word") throw new SyntaxError("Expected identifier"); return token.value; }
  private number(): number { const token = this.next(); if (!token || token.kind !== "number") throw new SyntaxError("Expected numeric LIMIT or OFFSET"); return Number(token.value); }
  private expectWord(value: string): void { if (!this.matchWord(value)) throw new SyntaxError(`Expected ${value}`); }
  private matchWord(value: string): boolean { return this.peek()?.kind === "word" && this.peek()!.value.toUpperCase() === value && (++this.position, true); }
  private expect(value: string): void { if (!this.match(value)) throw new SyntaxError(`Expected ${value}`); }
  private match(value: string): boolean { return this.peek()?.value === value && (++this.position, true); }
  private peek(offset = 0): Token | undefined { return this.tokens[this.position + offset]; }
  private next(): Token | undefined { return this.tokens[this.position++]; }
  end(): void { this.match(";"); if (this.peek()) throw new SyntaxError(`Unexpected token ${this.peek()!.value}`); }
}

/** Serializes the canonical AST; never interpolates values as executable JS. */
export function toSql(query: SelectQuery): string {
  const with_ = query.with?.length ? `WITH ${query.with.map(cte => `${id(cte.name)} AS (${toSql(cte.query)})`).join(", ")} ` : "";
  const select_ = `SELECT ${query.distinct ? "DISTINCT " : ""}${query.select.map(item => `${expressionSql(item.expression)}${item.alias ? ` AS ${id(item.alias)}` : ""}`).join(", ")}`;
  const joins = query.joins?.map(join => `${join.type === "INNER" ? "" : `${join.type} `}JOIN ${sourceSql(join.source)}${join.on ? ` ON ${expressionSql(join.on)}` : ""}`).join(" ") ?? "";
  const clauses = [select_, `FROM ${sourceSql(query.from)}`, joins, query.where && `WHERE ${expressionSql(query.where)}`, query.groupBy?.length && `GROUP BY ${query.groupBy.map(expressionSql).join(", ")}`, query.having && `HAVING ${expressionSql(query.having)}`].filter(Boolean).join(" ");
  const tail = [query.orderBy?.length && `ORDER BY ${query.orderBy.map(item => `${expressionSql(item.expression)} ${item.direction ?? "ASC"}`).join(", ")}`, query.limit !== undefined && `LIMIT ${query.limit}`, query.offset !== undefined && `OFFSET ${query.offset}`].filter(Boolean).join(" ");
  return `${with_}${clauses}${query.union?.map(item => ` UNION${item.all ? " ALL" : ""} ${toSql(item.query)}`).join("") ?? ""}${tail ? ` ${tail}` : ""}`;
}
function sourceSql(source: Source): string { return `${id(source.name)}${source.alias ? ` AS ${id(source.alias)}` : ""}`; }
function expressionSql(expression: Expression): string { switch (expression.type) { case "literal": return expression.value === null ? "NULL" : typeof expression.value === "string" ? `'${expression.value.replace(/'/g, "''")}'` : String(expression.value); case "parameter": return `@${expression.name}`; case "column": return expression.table ? `${id(expression.table)}.${id(expression.name)}` : id(expression.name); case "star": return "*"; case "unary": return `${expression.operator} ${expressionSql(expression.expression)}`; case "call": return `${expression.name}(${expression.arguments.map(expressionSql).join(", ")})`; case "binary": return `${expressionSql(expression.left)} ${expression.operator} ${Array.isArray(expression.right) ? `(${expression.right.map(expressionSql).join(", ")})` : expressionSql(expression.right)}`; } }
function id(value: string): string { return /^[A-Za-z_][\w$]*$/.test(value) ? value : `"${value.replace(/"/g, '""')}"`; }

type Scope = Record<string, Record<string, unknown> | undefined>;
type Group = { scope: Scope; rows: Scope[] };
/** Executes the AST against ordinary arrays. It is intentionally read-only. */
export function execute(query: SelectQuery, input: Tables, parameters: Parameters = {}): Record<string, unknown>[] {
  const tables: Tables = { ...input }; for (const cte of query.with ?? []) tables[cte.name] = execute(cte.query, tables, parameters);
  let rows = scopes(query.from, tables);
  for (const join of query.joins ?? []) rows = joinRows(rows, join, tables, parameters);
  if (query.where) rows = rows.filter(row => truth(value(query.where!, row, [], parameters)));
  const aggregate = hasAggregate(query);
  const grouped: Group[] = query.groupBy?.length ? groups(rows, query.groupBy, parameters) : aggregate ? [{ scope: rows[0] ?? {}, rows }] : rows.map(scope => ({ scope, rows: [scope] }));
  const filtered = query.groupBy?.length || aggregate ? grouped.filter(group => !query.having || truth(value(query.having, group.scope, group.rows, parameters))) : grouped;
  let result = filtered.map(group => project(query.select, group.scope, group.rows, parameters));
  for (const part of query.union ?? []) { const next = execute(part.query, tables, parameters); result = part.all ? [...result, ...next] : unique([...result, ...next]); }
  if (query.distinct) result = unique(result);
  if (query.orderBy?.length) result.sort((left, right) => order(query.orderBy!, left, parameters, right));
  return result.slice(query.offset ?? 0, query.limit === undefined ? undefined : (query.offset ?? 0) + query.limit);
}
function scopes(source: Source, tables: Tables): Scope[] { return (tables[source.name] ?? []).map(record => ({ [source.alias ?? source.name]: record })); }
function joinRows(left: Scope[], join: Join, tables: Tables, parameters: Parameters): Scope[] { const right = scopes(join.source, tables); const matches = (a: Scope, b: Scope) => !join.on || truth(value(join.on, { ...a, ...b }, [], parameters)); const result: Scope[] = []; const used = new Set<number>(); for (const a of left) { const found = right.map((b, i) => [b, i] as const).filter(([b]) => matches(a, b)); if (found.length) for (const [b, i] of found) { used.add(i); result.push({ ...a, ...b }); } else if (join.type === "LEFT" || join.type === "FULL") result.push({ ...a, [join.source.alias ?? join.source.name]: undefined }); } if (join.type === "RIGHT" || join.type === "FULL") right.forEach((b, i) => { if (!used.has(i)) result.push({ ...b }); }); return result; }
function groups(rows: Scope[], expressions: Expression[], parameters: Parameters): Group[] { const map = new Map<string, Group>(); for (const row of rows) { const key = JSON.stringify(expressions.map(expression => value(expression, row, [], parameters))); const group = map.get(key) ?? { scope: row, rows: [] }; group.rows.push(row); map.set(key, group); } return [...map.values()]; }
function project(items: SelectItem[], scope: Scope, rows: Scope[], parameters: Parameters): Record<string, unknown> { const output: Record<string, unknown> = {}; for (const item of items) { if (item.expression.type === "star") { for (const record of Object.values(scope)) Object.assign(output, record); continue; } const name = item.alias ?? (item.expression.type === "column" ? item.expression.name : item.expression.type === "call" ? item.expression.name.toLowerCase() : "expression"); output[name] = value(item.expression, scope, rows, parameters); } return output; }
function value(expression: Expression, scope: Scope, rows: Scope[], parameters: Parameters): unknown { switch (expression.type) { case "literal": return expression.value; case "parameter": return parameters[expression.name]; case "star": return undefined; case "column": { if (expression.table) return scope[expression.table]?.[expression.name]; for (const record of Object.values(scope)) if (record && expression.name in record) return record[expression.name]; return undefined; } case "unary": return expression.operator === "NOT" ? !truth(value(expression.expression, scope, rows, parameters)) : -Number(value(expression.expression, scope, rows, parameters)); case "call": return functionValue(expression, scope, rows, parameters); case "binary": return binaryValue(expression, scope, rows, parameters); } }
function functionValue(expression: Extract<Expression, { type: "call" }>, scope: Scope, rows: Scope[], parameters: Parameters): unknown { const name = expression.name, values = rows.map(row => value(expression.arguments[0] ?? { type: "star" }, row, [], parameters)); if (name === "COUNT") return expression.arguments[0]?.type === "star" ? rows.length : values.filter(item => item != null).length; if (name === "SUM") return values.reduce<number>((sum, item) => sum + Number(item ?? 0), 0); if (name === "AVG") return values.length ? values.reduce<number>((sum, item) => sum + Number(item ?? 0), 0) / values.length : null; if (name === "MIN") return values.filter(item => item != null).sort(compare)[0] ?? null; if (name === "MAX") return values.filter(item => item != null).sort(compare).at(-1) ?? null; const values_ = expression.arguments.map(argument => value(argument, scope, rows, parameters)); if (name === "LOWER") return String(values_[0] ?? "").toLowerCase(); if (name === "UPPER") return String(values_[0] ?? "").toUpperCase(); return values_.find(item => item != null) ?? null; }
function binaryValue(expression: Extract<Expression, { type: "binary" }>, scope: Scope, rows: Scope[], parameters: Parameters): unknown { const left = value(expression.left, scope, rows, parameters); const right = Array.isArray(expression.right) ? expression.right.map(item => value(item, scope, rows, parameters)) : value(expression.right, scope, rows, parameters); switch (expression.operator) { case "AND": return truth(left) && truth(right); case "OR": return truth(left) || truth(right); case "=": return left === right; case "<>": case "!=": return left !== right; case "<": return compare(left, right) < 0; case "<=": return compare(left, right) <= 0; case ">": return compare(left, right) > 0; case ">=": return compare(left, right) >= 0; case "+": return Number(left) + Number(right); case "-": return Number(left) - Number(right); case "*": return Number(left) * Number(right); case "/": return Number(left) / Number(right); case "IN": return Array.isArray(right) && right.includes(left); case "IS": return left === right; case "IS NOT": return left !== right; case "LIKE": return new RegExp("^" + String(right).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".") + "$", "i").test(String(left ?? "")); } }
function order(orderBy: Order[], left: Record<string, unknown>, parameters: Parameters, right: Record<string, unknown>): number { for (const item of orderBy) { const compared = compare(value(item.expression, { result: left }, [], parameters), value(item.expression, { result: right }, [], parameters)); if (compared) return item.direction === "DESC" ? -compared : compared; } return 0; }
function hasAggregate(query: SelectQuery): boolean { return [...query.select.map(item => item.expression), query.having].some(expression => expression && containsAggregate(expression)); }
function containsAggregate(expression: Expression): boolean { return expression.type === "call" ? ["COUNT", "SUM", "AVG", "MIN", "MAX"].includes(expression.name) : expression.type === "binary" ? containsAggregate(expression.left) || (Array.isArray(expression.right) ? expression.right.some(containsAggregate) : containsAggregate(expression.right)) : expression.type === "unary" ? containsAggregate(expression.expression) : false; }
function truth(value: unknown): boolean { return value === true; }
function compare(left: unknown, right: unknown): number { if (left === right) return 0; if (left == null) return -1; if (right == null) return 1; return left < right ? -1 : 1; }
function unique(rows: Record<string, unknown>[]): Record<string, unknown>[] { const seen = new Set<string>(); return rows.filter(row => { const key = JSON.stringify(row); if (seen.has(key)) return false; seen.add(key); return true; }); }
