import assert from "node:assert/strict";
import test from "node:test";
import { binary, column, execute, parameter, parse, select, toSql } from "../src/index.js";

const customers = [
  { id: 1, city: "Bogotá", state: "ACTIVE", age: 24, balance: 120 },
  { id: 2, city: "Bogotá", state: "ACTIVE", age: 35, balance: 80 },
  { id: 3, city: "Medellín", state: "INACTIVE", age: 42, balance: 200 },
  { id: 4, city: "Medellín", state: "ACTIVE", age: 16, balance: 50 }
];

test("parses, formats, and executes grouped SQL", () => {
  const sql = `SELECT city, COUNT(*) AS customer_count, AVG(age) AS average_age, SUM(balance) AS total_balance, MAX(balance) AS max_balance
    FROM customers
    WHERE state = 'ACTIVE' AND age >= 18 AND balance > 0
    GROUP BY city
    HAVING COUNT(*) >= 2
    ORDER BY total_balance DESC`;
  const ast = parse(sql);
  assert.equal(ast.type, "select");
  assert.match(toSql(ast), /GROUP BY city HAVING COUNT\(\*\) >= 2 ORDER BY total_balance DESC/);
  assert.deepEqual(execute(ast, { customers }), [{ city: "Bogotá", customer_count: 2, average_age: 29.5, total_balance: 200, max_balance: 120 }]);
});

test("builds JavaScript DSL into the same AST and supports parameters", () => {
  const query = select("*")
    .from("customers", "customer")
    .where(binary("=", column("id", "customer"), parameter("id")));
  assert.match(query.toSql(), /SELECT \* FROM customers AS customer WHERE customer.id = @id/);
  assert.deepEqual(query.execute({ customers }, { id: 2 }), [customers[1]]);
});

test("supports CTEs, joins, UNION, LIMIT, and OFFSET in the portable AST", () => {
  const query = parse(`WITH active AS (SELECT * FROM customers WHERE state = 'ACTIVE')
    SELECT a.id, c.city FROM active a INNER JOIN customers c ON a.id = c.id
    UNION SELECT id, city FROM customers WHERE id = 3 ORDER BY id ASC LIMIT 2 OFFSET 1`);
  assert.deepEqual(execute(query, { customers }), [{ id: 2, city: "Bogotá" }, { id: 3, city: "Medellín" }]);
});
