# ExensialQuery

`exensialquery` is a dependency-free, read-only SQL subset for JavaScript and TypeScript. Its canonical AST can be parsed from SQL, built directly from JavaScript, formatted back to SQL, or executed against ordinary arrays of objects.

It is deliberately not a database driver and does not execute submitted JavaScript. That makes the same AST portable between a browser lookup, an in-memory test, an Exensial repository adapter, and a future database compiler.

## Supported SQL subset

`WITH`, `SELECT`, `DISTINCT`, `FROM`, `INNER`/`LEFT`/`RIGHT`/`FULL`/`CROSS JOIN`, `WHERE`, `AND`, `OR`, `NOT`, comparison operators, `IN`, `LIKE`, `IS NULL`, `GROUP BY`, `HAVING`, `COUNT`, `SUM`, `AVG`, `MIN`, `MAX`, `LOWER`, `UPPER`, `COALESCE`, `ORDER BY`, `LIMIT`, `OFFSET`, `UNION`, and `UNION ALL`.

Named parameters use `@name`. The package is read-only: it intentionally excludes `INSERT`, `UPDATE`, `DELETE`, DDL, vendor functions, subqueries outside `WITH`, and arbitrary SQL execution.

## SQL → AST → array result

```ts
import { execute, parse, toSql } from "exensialquery";

const query = parse(`
  SELECT city, COUNT(*) AS customer_count, AVG(age) AS average_age,
         SUM(balance) AS total_balance, MAX(balance) AS max_balance
  FROM customers
  WHERE state = 'ACTIVE' AND age >= 18 AND balance > 0
  GROUP BY city
  HAVING COUNT(*) >= 2
  ORDER BY total_balance DESC
`);

const sql = toSql(query); // canonical SQL generated from the portable AST
const rows = execute(query, { customers });
```

The AST is ordinary JSON-compatible data. It can be persisted or sent over HTTP after the host validates table names and authorization:

```ts
{
  type: "select",
  from: { type: "table", name: "customers" },
  select: [{ expression: { type: "column", name: "city" } }],
  where: {
    type: "binary", operator: "=",
    left: { type: "column", table: "customer", name: "id" },
    right: { type: "parameter", name: "id" }
  }
}
```

## JavaScript → AST → SQL

There is no safe, general conversion from an arbitrary JavaScript function to SQL: a function can call the network, mutate state, branch on time, or use code with no relational equivalent. Instead, the builder is JavaScript that creates the same constrained AST directly.

```ts
import { binary, column, parameter, select } from "exensialquery";

const getCustomerById = select("*")
  .from("customers", "customer")
  .where(binary("=", column("id", "customer"), parameter("id")));

getCustomerById.toSql();
// SELECT * FROM customers AS customer WHERE customer.id = @id

getCustomerById.execute({ customers }, { id: 3 });
```

`toAst()` returns the canonical AST, `toSql()` formats it, and `execute()` is the array-equivalent function. This gives a deterministic JS → AST → SQL path without attempting to inspect or run arbitrary function source.

## Packaging and adapters

Build with `npm run build` inside this directory. The generated `dist/` package has no runtime dependencies and runs in browsers and Node.js. A later Exensial adapter can validate this AST against an entity catalog and translate it to repository predicates or database SQL without changing callers.

## Parser choice

This package keeps its own portable AST and parser for the supported dialect. `node-sql-parser` was not adopted because its published license is GPLv2. `pgsql-ast-parser` is MIT and browser-compatible, so it remains a sensible optional PostgreSQL adapter where full PostgreSQL syntax is required; its AST is not exposed as ExensialQuery's public contract.
