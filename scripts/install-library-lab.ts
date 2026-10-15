import { hashPassword } from "../src/application/security";

const withPermissions = process.argv.includes("--permissions");
const baseUrl = process.argv.find((argument) => argument.startsWith("http")) ?? process.env.EXENSIAL_URL ?? "http://localhost:3000";
let accessToken: string | undefined;
const labUiKeys = new Set(["consoleHint", "loading", "language", "rows", "newRecord", "new", "save", "cancel", "close", "actions", "edit", "delete", "deleteConfirmation", "previous", "next", "page", "of", "records", "select", "filter", "matchingRecords", "noRecords", "noEntities", "noMatches", "noSearchFields", "find", "noRecordSelected", "saved", "deleted", "signIn", "signOut", "guest", "anonymous", "authenticated", "sessionExpired", "username", "password", "changePassword", "currentPassword", "newPassword", "updatePassword", "passwordUpdated", "editProfile", "email", "group.Library", "group.System"].map((key) => `ui.${key}`));
const labEntityLocalizationPrefixes = ["library.", "openapi.exensialQuery.", "entity.library.", "entity.roles.", "entity.users.", "entity.userRoles.", "entity.permissions.", "entity.entities.", "entity.localizations.", "entity.requests.", "entity.responses."];

async function request(method: string, path: string, body?: unknown): Promise<any> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = response.status === 204 ? undefined : await response.json();
  if (!response.ok) throw new Error(`${method} ${path}: ${data?.error ?? response.statusText}`);
  return data;
}

async function signInIfPresent(): Promise<void> {
  const response = await fetch(`${baseUrl}/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "admin", password: "admin123" }) });
  if (response.ok) accessToken = (await response.json()).accessToken;
}

const booksDefinition = String.raw`/**
 * @exensial.title en Library books
 * @exensial.title es Libros
 * @exensial.description en Catalog records and copy availability for the library.
 * @exensial.operation list en List books
 * @exensial.operation list es Listar libros
 * @exensial.operation create en Create or import books
 * @exensial.operation create es Crear o importar libros
 * @exensial.operation get en Get a book
 * @exensial.operation get es Consultar un libro
 * @exensial.operation replace en Replace a book
 * @exensial.operation replace es Reemplazar un libro
 * @exensial.operation update en Update a book
 * @exensial.operation update es Actualizar un libro
 * @exensial.operation delete en Delete a book
 * @exensial.operation delete es Eliminar un libro
 * @exensial.operation query en Query books
 * @exensial.operation query es Consultar libros
 */
type Book = {
  /** @exensial.title en Title
   * @exensial.title es Título
   * @exensial.description en The title shown to readers.
   * @exensial.ui.searchable */
  title: string;
  /** @exensial.title en Author
   * @exensial.title es Autor
   * @exensial.ui.searchable */
  author: string;
  /** @exensial.title en ISBN
   * @exensial.title es ISBN
   * @exensial.ui.searchable */
  isbn: string;
  /** @exensial.title en Total copies
   * @exensial.title es Total de copias
   * @exensial.ui.control number
   * @exensial.default 1 */
  copiesTotal: number;
  /**
   * @exensial.title en Available copies
   * @exensial.title es Copias disponibles
   * @exensial.ui.control number
   * @exensial.default 1
   */
  copiesAvailable?: number;
}`;

const membersDefinition = String.raw`/**
 * @exensial.title en Library members
 * @exensial.title es Miembros
 * @exensial.description en People who can borrow books from the library.
 * @exensial.operation list en List members
 * @exensial.operation list es Listar miembros
 * @exensial.operation create en Create or import members
 * @exensial.operation create es Crear o importar miembros
 * @exensial.operation get en Get a member
 * @exensial.operation get es Consultar un miembro
 * @exensial.operation replace en Replace a member
 * @exensial.operation replace es Reemplazar un miembro
 * @exensial.operation update en Update a member
 * @exensial.operation update es Actualizar un miembro
 * @exensial.operation delete en Delete a member
 * @exensial.operation delete es Eliminar un miembro
 * @exensial.operation query en Query members
 * @exensial.operation query es Consultar miembros
 */
type Member = {
  /** @exensial.title en Name
   * @exensial.title es Nombre
   * @exensial.ui.searchable */
  name: string;
  /** @exensial.title en Email
   * @exensial.title es Correo electrónico
   * @exensial.ui.control email
   * @exensial.ui.searchable */
  email: string;
  /** @exensial.title en User account
   * @exensial.title es Cuenta de usuario
   * @exensial.relation users label=username */
  user?: User;
  /** @exensial.title en Active
   * @exensial.title es Activo
   * @exensial.default true */
  active?: boolean;
}`;

const loansDefinition = String.raw`/**
 * @exensial.title en Book loans
 * @exensial.title es Préstamos
 * @exensial.description en Circulation records for borrowed and returned books.
 * @exensial.operation list en List loans
 * @exensial.operation list es Listar préstamos
 * @exensial.operation create en Create or import loans
 * @exensial.operation create es Crear o importar préstamos
 * @exensial.operation get en Get a loan
 * @exensial.operation get es Consultar un préstamo
 * @exensial.operation replace en Replace a loan
 * @exensial.operation replace es Reemplazar un préstamo
 * @exensial.operation update en Update a loan
 * @exensial.operation update es Actualizar un préstamo
 * @exensial.operation delete en Delete a loan
 * @exensial.operation delete es Eliminar un préstamo
 * @exensial.operation query en Query loans
 * @exensial.operation query es Consultar préstamos
 */
type Loan = {
  /** @exensial.title en Book
   * @exensial.title es Libro
   * @exensial.relation library/books label=title */
  book: Book;
  /** @exensial.title en Member
   * @exensial.title es Miembro
   * @exensial.relation library/members label=name */
  member: Member;
  /** @exensial.title en Borrowed at
   * @exensial.title es Fecha de préstamo
   * @exensial.description en Defaults to the current server time when omitted.
   * @exensial.description es Usa la hora actual del servidor cuando se omite.
   * @exensial.ui.control datetime */
  borrowedAt?: string;
  /** @exensial.title en Due at
   * @exensial.title es Fecha límite
   * @exensial.ui.control datetime */
  dueAt: string;
  /** @exensial.title en Returned at
   * @exensial.title es Fecha de devolución
   * @exensial.ui.control datetime */
  returnedAt?: string;
  /** @exensial.ui.hidden */
  status?: string;
}`;

const booksCode = String.raw`
function prepare(book, fail) {
  for (const field of ["title", "author", "isbn"]) book[field] = String(book[field] ?? "").trim();
  book.isbn = book.isbn.toUpperCase();
  if (!book.title || !book.author || !book.isbn) fail("library.books.error.requiredFields", "Book title, author, and ISBN are required");
  if (!Number.isInteger(book.copiesTotal) || book.copiesTotal < 1) fail("library.books.error.copiesTotalPositive", "Total copies must be a positive integer");
  book.copiesAvailable = book.copiesTotal;
}
export default {
  create: async (context, next) => { prepare(context.input, context.fail); await next(); },
  bulkCreate: async (context, next) => { for (const book of context.input) prepare(book, context.fail); await next(); },
  update: async (context, next) => {
    const change = context.input, current = context.current;
    for (const field of ["title", "author"]) if (field in change) change[field] = String(change[field]).trim();
    if ("isbn" in change) change.isbn = String(change.isbn).trim().toUpperCase();
    if ("copiesTotal" in change) {
      if (!Number.isInteger(change.copiesTotal) || change.copiesTotal < 1) context.fail("library.books.error.copiesTotalPositive", "Total copies must be a positive integer");
      const borrowed = Number(current.copiesTotal) - Number(current.copiesAvailable);
      if (Number(change.copiesTotal) < borrowed) context.fail("library.books.error.copiesBelowBorrowed", "Total copies cannot be lower than borrowed copies");
      change.copiesAvailable = Number(change.copiesTotal) - borrowed;
    }
    await next();
  }
};`;

const membersCode = String.raw`
function assertUserIsAvailable(member, currentId, members, fail) {
  if (!member.user) return;
  const assigned = members.findBy("user", String(member.user)).find((other) => other.id !== currentId);
  if (assigned) fail("library.members.error.userAlreadyAssigned", "A user can be associated with only one member");
}
function prepare(member, fail) {
  member.name = String(member.name ?? "").trim();
  member.email = String(member.email ?? "").trim().toLowerCase();
  if (!member.name || !member.email.includes("@")) fail("library.members.error.requiredFields", "A name and valid email are required");
  member.active = true;
}
export default {
  create: async (context, next) => { prepare(context.input, context.fail); assertUserIsAvailable(context.input, undefined, context.collection("members", "library"), context.fail); await next(); },
  bulkCreate: async (context, next) => {
    const users = new Set();
    for (const member of context.input) {
      prepare(member, context.fail);
      assertUserIsAvailable(member, undefined, context.collection("members", "library"), context.fail);
      if (member.user && users.has(String(member.user))) context.fail("library.members.error.userAlreadyAssigned", "A user can be associated with only one member");
      if (member.user) users.add(String(member.user));
    }
    await next();
  },
  update: async (context, next) => {
    const member = context.input;
    if ("name" in member) member.name = String(member.name).trim();
    if ("email" in member) { member.email = String(member.email).trim().toLowerCase(); if (!member.email.includes("@")) context.fail("library.members.error.validEmail", "A valid email is required"); }
    if ("user" in member) assertUserIsAvailable(member, context.current.id, context.collection("members", "library"), context.fail);
    await next();
  }
};`;

const loansCode = String.raw`
const isDate = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));
export default {
  create: async (context, next) => {
    const loan = context.input;
    if (!String(loan.borrowedAt ?? "").trim()) loan.borrowedAt = new Date().toISOString();
    for (const field of ["book", "member", "dueAt"]) if (!String(loan[field] ?? "").trim()) context.fail("library.loans.error.requiredFields", "Book, member, and due date are required");
    const books = context.collection("books", "library"), members = context.collection("members", "library");
    const book = books.get(String(loan.book)), member = members.get(String(loan.member));
    if (!member?.active) context.fail("library.loans.error.memberInactive", "Member is not active");
    if (!book || Number(book.copiesAvailable) < 1) context.fail("library.loans.error.bookUnavailable", "Book is not available");
    if (!isDate(loan.borrowedAt) || !isDate(loan.dueAt) || Date.parse(loan.dueAt) <= Date.parse(loan.borrowedAt)) context.fail("library.loans.error.dueDate", "Due date must be later than the borrowed date");
    await books.update(book.id, { copiesAvailable: Number(book.copiesAvailable) - 1 });
    try { delete loan.returnedAt; loan.status = "active"; await next(); }
    catch (error) { await books.update(book.id, { copiesAvailable: Number(book.copiesAvailable) }); throw error; }
  },
  update: async (context, next) => {
    const loan = context.current, change = context.input;
    if (loan.status !== "active" || change.status !== "returned" || !isDate(change.returnedAt)) context.fail("library.loans.error.returnActiveLoan", "Only an active loan with a returned date may be returned");
    const books = context.collection("books", "library"), book = books.get(String(loan.book));
    const available = Number(book.copiesAvailable) + 1;
    if (available > Number(book.copiesTotal)) context.fail("library.loans.error.availableAboveTotal", "Available copies cannot exceed total copies");
    await next();
    await books.update(book.id, { copiesAvailable: available });
  },
  delete: async (context, next) => { if (context.current.status === "active") context.fail("library.loans.error.activeCannotDelete", "Active loans cannot be deleted"); await next(); },
  bulkCreate: async (context) => context.fail("library.loans.error.bulkCreate", "Bulk loan creation is not allowed")
};`;

const domainErrorLocalizations = [
  ["library.books.error.requiredFields", "Book title, author, and ISBN are required", "El título, el autor y el ISBN son obligatorios."],
  ["library.books.error.copiesTotalPositive", "Total copies must be a positive integer", "El total de copias debe ser un entero positivo."],
  ["library.books.error.copiesBelowBorrowed", "Total copies cannot be lower than borrowed copies", "El total de copias no puede ser menor que las copias prestadas."],
  ["library.members.error.requiredFields", "A name and valid email are required", "El nombre y un correo electrónico válido son obligatorios."],
  ["library.members.error.validEmail", "A valid email is required", "Se requiere un correo electrónico válido."],
  ["library.members.error.userAlreadyAssigned", "A user can be associated with only one member", "Un usuario solo puede estar asociado a un miembro."],
  ["library.loans.error.requiredFields", "Book, member, and due date are required", "El libro, el miembro y la fecha límite son obligatorios."],
  ["library.loans.error.memberInactive", "Member is not active", "El miembro no está activo."],
  ["library.loans.error.bookUnavailable", "Book is not available", "El libro no está disponible."],
  ["library.loans.error.dueDate", "Due date must be later than the borrowed date", "La fecha límite debe ser posterior a la fecha de préstamo."],
  ["library.loans.error.returnActiveLoan", "Only an active loan with a returned date may be returned", "Solo se puede devolver un préstamo activo con fecha de devolución."],
  ["library.loans.error.availableAboveTotal", "Available copies cannot exceed total copies", "Las copias disponibles no pueden superar el total de copias."],
  ["library.loans.error.activeCannotDelete", "Active loans cannot be deleted", "Los préstamos activos no se pueden eliminar."],
  ["library.loans.error.bulkCreate", "Bulk loan creation is not allowed", "No se permite la creación masiva de préstamos."]
] as const;

async function resetLibrary(): Promise<void> {
  await signInIfPresent();
  for (const entity of ["menus", "views", "useCases"]) {
    const records = await request("GET", `/v1/${entity}`) as Array<{ id: string }>;
    for (const record of records) await request("DELETE", `/v1/${entity}/${record.id}`);
  }
  if (withPermissions) {
    for (const entity of ["permissions", "userRoles", "users", "roles"]) {
      const records = await request("GET", `/v1/${entity}`) as Array<{ id: string }>;
      for (const record of records) await request("DELETE", `/v1/${entity}/${record.id}`);
    }
    accessToken = undefined;
  }
  const entities = await request("GET", "/v1/entities") as Array<{ id: string; name: string; namespace?: string }>;
  for (const entity of entities.filter((item) => item.namespace === "library" && ["loans", "members", "books"].includes(item.name))) {
    await request("DELETE", `/v1/entities/${entity.id}`);
  }
  const localizations = await request("GET", "/v1/localizations") as Array<{ id: string; key: string; locale: string }>;
  for (const entry of localizations.filter((item) => labEntityLocalizationPrefixes.some((prefix) => item.key.startsWith(prefix)) || (item.locale === "es" && labUiKeys.has(item.key)))) await request("DELETE", `/v1/localizations/${entry.id}`);
}

async function installPermissions(): Promise<void> {
  const roles = (await request("POST", "/v1/roles", [
    { name: "anonymous", description: "Public access without an authenticated user." },
    { name: "library-reader", description: "Reads the public book catalog." },
    { name: "library-admin", description: "Administers the library and Exensial system catalogs." }
  ])).items;
  const roleId = Object.fromEntries(roles.map((role: { id: string; name: string }) => [role.name, role.id]));
  const users = (await request("POST", "/v1/users", [
    { username: "reader", email: "reader@library.local", passwordHash: hashPassword("reader123"), roles: [], active: true },
    { username: "admin", email: "admin@library.local", passwordHash: hashPassword("admin123"), roles: [], active: true },
    { username: "ana", email: "ana.torres@example.com", passwordHash: hashPassword("member123"), roles: [], active: true },
    { username: "mateo", email: "mateo.rios@example.com", passwordHash: hashPassword("member123"), roles: [], active: true },
    { username: "sofia", email: "sofia.perez@example.com", passwordHash: hashPassword("member123"), roles: [], active: true }
  ])).items;
  const userId = Object.fromEntries(users.map((user: { id: string; username: string }) => [user.username, user.id]));
  await request("POST", "/v1/userRoles", [
    { user: userId.reader, role: roleId["library-reader"] },
    { user: userId.admin, role: roleId["library-admin"] }
  ]);
  const members = await request("GET", "/v1/library/members") as Array<{ id: string; email: string }>;
  for (const member of members) {
    const username = member.email.split(".")[0];
    if (userId[username]) await request("PATCH", `/v1/library/members/${member.id}`, { user: userId[username] });
  }
  const protectedPaths = ["/v1/library/members*", "/v1/library/loans*", "/v1/entities*", "/v1/localizations*", "/v1/requests*", "/v1/responses*", "/v1/roles*", "/v1/users*", "/v1/userRoles*", "/v1/permissions*", "/v1/useCases*", "/v1/views*", "/v1/menus*"];
  const permissions = [
    { role: roleId.anonymous, method: "GET", path: "/v1/library/books*", decision: "allow" },
    { role: roleId.anonymous, method: "GET", path: "/v1/query/exensial/library/books*", decision: "allow" },
    { role: roleId["library-reader"], method: "GET", path: "/v1/*", decision: "allow" },
    { role: roleId["library-admin"], method: "GET", path: "/v1/library/books*", decision: "allow" },
    { role: roleId["library-admin"], method: "GET", path: "/v1/query/exensial/*", decision: "allow" },
    ...["POST", "PUT", "PATCH", "DELETE"].map((method) => ({ role: roleId["library-admin"], method, path: "/v1/library/books*", decision: "allow" })),
    ...protectedPaths.map((path) => ({ role: roleId["library-admin"], method: "*", path, decision: "allow" }))
  ];
  await request("POST", "/v1/permissions", permissions);
}

async function install(): Promise<void> {
  await resetLibrary();
  await request("POST", "/v1/entities", { name: "books", version: "1.0.0", namespace: "library", group: "Library", icon: "book,📚", definition: booksDefinition, code: booksCode });
  await request("POST", "/v1/entities", { name: "members", version: "1.0.0", namespace: "library", group: "Library", icon: "users,👥", definition: membersDefinition, code: membersCode });
  await request("POST", "/v1/entities", { name: "loans", version: "1.0.0", namespace: "library", group: "Library", icon: "calendar,📅", definition: loansDefinition, code: loansCode });
  await request("POST", "/v1/useCases", {
    useCaseId: "Library_ReturnLoans", name: "Return selected loans", description: "Returns active loans and releases their book copies.", icon: "undo,↩",
    route: { namespace: "library", entity: "loans", action: "return", method: "POST" },
    inputs: [{ name: "loans", entity: "loans", namespace: "library", minItems: 1 }],
    parameters: [{ name: "returnedAt", type: "string", control: "datetime", required: true }],
    enableCondition: { all: [{ field: "status", equals: "active" }, { field: "returnedAt", empty: true }] },
    code: String.raw`export default async function ({ inputs, parameters, records, fail }) {
  const returnedAt = String(parameters.returnedAt || "");
  if (!returnedAt || Number.isNaN(Date.parse(returnedAt))) fail("library.loans.error.returnActiveLoan");
  const returned = [];
  for (const loan of inputs.loans) {
    if (loan.status !== "active") fail("library.loans.error.returnActiveLoan");
    await records.update("loans", loan.id, { status: "returned", returnedAt }, "library");
    returned.push(loan.id);
  }
  return { returned };
}`
  });
  await request("POST", "/v1/views", [
    { viewId: "Library_Book_QueryView", kind: "query", name: "Library book catalog", target: { namespace: "library", entity: "books", slot: "query" }, columns: ["title", "author", "isbn", "copiesAvailable"], source: { language: "exensialquery", ast: { type: "select", from: { type: "table", name: "library.books", alias: "book" }, select: [{ expression: { type: "column", table: "book", name: "id" } }, { expression: { type: "column", table: "book", name: "title" } }, { expression: { type: "column", table: "book", name: "author" } }, { expression: { type: "column", table: "book", name: "isbn" } }, { expression: { type: "column", table: "book", name: "copiesAvailable" } }] } } },
    { viewId: "Library_ActiveLoan_QueryView", kind: "query", name: "Active library loans", target: { namespace: "library", entity: "loans", slot: "query" }, columns: ["title", "member", "dueAt"], source: { language: "exensialquery", ast: { type: "select", from: { type: "table", name: "library.loans", alias: "loan" }, joins: [{ type: "INNER", source: { type: "table", name: "library.books", alias: "book" }, on: { type: "binary", operator: "=", left: { type: "column", table: "loan", name: "book" }, right: { type: "column", table: "book", name: "id" } } }, { type: "INNER", source: { type: "table", name: "library.members", alias: "member" }, on: { type: "binary", operator: "=", left: { type: "column", table: "loan", name: "member" }, right: { type: "column", table: "member", name: "id" } } }], where: { type: "binary", operator: "=", left: { type: "column", table: "loan", name: "status" }, right: { type: "literal", value: "active" } }, select: [{ expression: { type: "column", table: "loan", name: "id" } }, { expression: { type: "column", table: "book", name: "title" } }, { expression: { type: "column", table: "member", name: "name" }, alias: "member" }, { expression: { type: "column", table: "loan", name: "dueAt" } }] } } },
    { viewId: "Library_Book_DetailView", kind: "detail", name: "Library book detail", target: { namespace: "library", entity: "books", slot: "detail" }, fields: ["title", "author", "isbn", "copiesTotal", "copiesAvailable"] }
  ]);
  await request("POST", "/v1/menus", [
    { menuId: "library.bookCatalog", position: 10, visible: true, icon: "book,📚", viewId: "Library_Book_QueryView" },
    { menuId: "library.activeLoans", position: 20, visible: true, icon: "calendar,📅", viewId: "Library_ActiveLoan_QueryView" }
  ]);
  await request("POST", "/v1/localizations", [
    ...domainErrorLocalizations.flatMap(([key, english, spanish]) => [
      { locale: "en", key, value: english },
      { locale: "es", key, value: spanish }
    ]),
    { locale: "es", key: "usecase.Library_ReturnLoans.name", value: "Devolver préstamos seleccionados" },
    { locale: "es", key: "usecase.Library_ReturnLoans.description", value: "Devuelve préstamos activos y libera las copias de sus libros." },
    { locale: "es", key: "openapi.exensialQuery.capability.description", value: "Capacidad opcional de lectura similar a OData. Admite $filter (contains, startswith, endswith, eq, ne, gt, ge, lt y le unidos con and), $skip y $top. Solo se pueden consultar campos anotados como buscables o filtrables." },
    { locale: "es", key: "openapi.exensialQuery.description", value: "Usa la capacidad opcional ExensialQuery. Es un subconjunto seguro y de solo lectura similar a OData; en $filter solo se pueden usar campos anotados con @exensial.ui.searchable o @exensial.ui.filterable." },
    { locale: "es", key: "openapi.exensialQuery.filter.description", value: "Ejemplos: contains(title, 'Dune') o copiesAvailable gt 0. Las cláusulas se pueden unir con and." },
    { locale: "es", key: "openapi.exensialQuery.skip.description", value: "Cantidad de registros coincidentes que se omiten. El valor predeterminado es 0." },
    { locale: "es", key: "openapi.exensialQuery.top.description", value: "Máximo de registros coincidentes que se devuelven. El valor predeterminado es 25 y el máximo es 100." },
    { locale: "es", key: "openapi.exensialQuery.response.matched", value: "Se devolvieron los registros coincidentes. X-Total-Count indica el total antes de paginar." },
    { locale: "es", key: "ui.consoleHint", value: "Consola de entidades en tiempo de ejecución" },
    { locale: "es", key: "ui.loading", value: "Cargando…" },
    { locale: "es", key: "ui.language", value: "Idioma" },
    { locale: "es", key: "ui.rows", value: "Filas" },
    { locale: "es", key: "ui.newRecord", value: "Nuevo registro" },
    { locale: "es", key: "ui.new", value: "Nuevo" },
    { locale: "es", key: "ui.save", value: "Guardar" },
    { locale: "es", key: "ui.cancel", value: "Cancelar" },
    { locale: "es", key: "ui.close", value: "Cerrar" },
    { locale: "es", key: "ui.actions", value: "Acciones" },
    { locale: "es", key: "ui.edit", value: "Editar" },
    { locale: "es", key: "ui.delete", value: "Eliminar" },
    { locale: "es", key: "ui.deleteConfirmation", value: "¿Eliminar este registro?" },
    { locale: "es", key: "ui.previous", value: "Anterior" },
    { locale: "es", key: "ui.next", value: "Siguiente" },
    { locale: "es", key: "ui.page", value: "Página" },
    { locale: "es", key: "ui.of", value: "de" },
    { locale: "es", key: "ui.records", value: "registros" },
    { locale: "es", key: "ui.select", value: "Seleccionar" },
    { locale: "es", key: "ui.filter", value: "Filtrar" },
    { locale: "es", key: "ui.matchingRecords", value: "registros coincidentes" },
    { locale: "es", key: "ui.noRecords", value: "Aún no hay registros." },
    { locale: "es", key: "ui.noEntities", value: "No hay entidades instaladas." },
    { locale: "es", key: "ui.noMatches", value: "No hay registros coincidentes." },
    { locale: "es", key: "ui.noSearchFields", value: "Esta entidad no expone campos que se puedan buscar." },
    { locale: "es", key: "ui.find", value: "Buscar" },
    { locale: "es", key: "ui.noRecordSelected", value: "No se ha seleccionado un registro" },
    { locale: "es", key: "ui.saved", value: "Guardado." },
    { locale: "es", key: "ui.deleted", value: "Eliminado." },
    { locale: "es", key: "ui.signIn", value: "Iniciar sesión" },
    { locale: "es", key: "ui.signOut", value: "Cerrar sesión" },
    { locale: "es", key: "ui.guest", value: "Invitado" },
    { locale: "es", key: "ui.anonymous", value: "Acceso anónimo" },
    { locale: "es", key: "ui.authenticated", value: "Autenticado" },
    { locale: "es", key: "ui.sessionExpired", value: "Tu sesión expiró. Inicia sesión de nuevo." },
    { locale: "es", key: "ui.username", value: "Usuario" },
    { locale: "es", key: "ui.password", value: "Contraseña" },
    { locale: "es", key: "ui.changePassword", value: "Cambiar contraseña" },
    { locale: "es", key: "ui.currentPassword", value: "Contraseña actual" },
    { locale: "es", key: "ui.newPassword", value: "Contraseña nueva" },
    { locale: "es", key: "ui.updatePassword", value: "Actualizar contraseña" },
    { locale: "es", key: "ui.passwordUpdated", value: "Contraseña actualizada." },
    { locale: "es", key: "ui.editProfile", value: "Editar mi perfil" },
    { locale: "es", key: "ui.email", value: "Correo electrónico" },
    { locale: "es", key: "ui.group.Library", value: "Biblioteca" },
    { locale: "es", key: "ui.group.System", value: "Sistema" },
    { locale: "es", key: "entity.library.books.title", value: "Libros" },
    { locale: "es", key: "entity.library.members.title", value: "Miembros" },
    { locale: "es", key: "entity.library.loans.title", value: "Préstamos" },
    { locale: "es", key: "entity.library.books.field.title.title", value: "Título" },
    { locale: "es", key: "entity.library.books.field.copiesAvailable.title", value: "Copias disponibles" },
    { locale: "es", key: "entity.library.loans.field.book.title", value: "Libro" },
    { locale: "es", key: "entity.library.loans.field.member.title", value: "Miembro" }
    ,{ locale: "es", key: "entity.library.books.field.author.title", value: "Autor" }
    ,{ locale: "es", key: "entity.library.books.field.isbn.title", value: "ISBN" }
    ,{ locale: "es", key: "entity.library.books.field.copiesTotal.title", value: "Total de copias" }
    ,{ locale: "es", key: "entity.library.members.field.name.title", value: "Nombre" }
    ,{ locale: "es", key: "entity.library.members.field.email.title", value: "Correo electrónico" }
    ,{ locale: "es", key: "entity.library.members.field.user.title", value: "Cuenta de usuario" }
    ,{ locale: "es", key: "entity.library.members.field.active.title", value: "Activo" }
    ,{ locale: "es", key: "entity.library.loans.field.borrowedAt.title", value: "Fecha de préstamo" }
    ,{ locale: "es", key: "entity.library.loans.field.dueAt.title", value: "Fecha límite" }
    ,{ locale: "es", key: "entity.library.loans.field.returnedAt.title", value: "Fecha de devolución" }
    ,{ locale: "es", key: "entity.library.loans.field.status.title", value: "Estado" }
    ,{ locale: "es", key: "entity.roles.title", value: "Roles" }
    ,{ locale: "es", key: "entity.roles.field.name.title", value: "Nombre del rol" }
    ,{ locale: "es", key: "entity.roles.field.description.title", value: "Descripción" }
    ,{ locale: "es", key: "entity.users.title", value: "Usuarios" }
    ,{ locale: "es", key: "entity.users.field.username.title", value: "Usuario" }
    ,{ locale: "es", key: "entity.users.field.email.title", value: "Correo electrónico" }
    ,{ locale: "es", key: "entity.users.field.password.title", value: "Contraseña inicial" }
    ,{ locale: "es", key: "entity.users.field.active.title", value: "Activo" }
    ,{ locale: "es", key: "entity.userRoles.title", value: "Roles de usuario" }
    ,{ locale: "es", key: "entity.userRoles.field.user.title", value: "Usuario" }
    ,{ locale: "es", key: "entity.userRoles.field.role.title", value: "Rol" }
    ,{ locale: "es", key: "entity.permissions.title", value: "Permisos de endpoints" }
    ,{ locale: "es", key: "entity.permissions.field.role.title", value: "Rol" }
    ,{ locale: "es", key: "entity.permissions.field.method.title", value: "Método HTTP" }
    ,{ locale: "es", key: "entity.permissions.field.path.title", value: "Patrón de ruta" }
    ,{ locale: "es", key: "entity.permissions.field.decision.title", value: "Decisión de permiso" }
    ,{ locale: "es", key: "entity.entities.title", value: "Catálogo de entidades" }
    ,{ locale: "es", key: "entity.entities.field.name.title", value: "Nombre de ruta" }
    ,{ locale: "es", key: "entity.entities.field.version.title", value: "Versión de entidad" }
    ,{ locale: "es", key: "entity.entities.field.definition.title", value: "Tipo TypeScript" }
    ,{ locale: "es", key: "entity.entities.field.namespace.title", value: "Espacio de nombres" }
    ,{ locale: "es", key: "entity.entities.field.group.title", value: "Grupo del menú" }
    ,{ locale: "es", key: "entity.entities.field.icon.title", value: "Ícono del menú" }
    ,{ locale: "es", key: "entity.entities.field.code.title", value: "Módulo de dominio TypeScript" }
    ,{ locale: "es", key: "entity.localizations.title", value: "Catálogo de localizaciones" }
    ,{ locale: "es", key: "entity.localizations.field.locale.title", value: "Idioma" }
    ,{ locale: "es", key: "entity.localizations.field.key.title", value: "Clave" }
    ,{ locale: "es", key: "entity.localizations.field.value.title", value: "Texto" }
    ,{ locale: "es", key: "entity.requests.title", value: "Registro de solicitudes" }
    ,{ locale: "es", key: "entity.requests.field.apiVersion.title", value: "Versión de API" }
    ,{ locale: "es", key: "entity.requests.field.receivedAt.title", value: "Recibida el" }
    ,{ locale: "es", key: "entity.requests.field.namespace.title", value: "Espacio de nombres" }
    ,{ locale: "es", key: "entity.requests.field.entityName.title", value: "Entidad" }
    ,{ locale: "es", key: "entity.requests.field.action.title", value: "Operación" }
    ,{ locale: "es", key: "entity.requests.field.payload.title", value: "Carga" }
    ,{ locale: "es", key: "entity.responses.title", value: "Registro de respuestas" }
    ,{ locale: "es", key: "entity.responses.field.status.title", value: "Estado HTTP" }
    ,{ locale: "es", key: "entity.responses.field.completedAt.title", value: "Completada el" }
    ,{ locale: "es", key: "entity.responses.field.durationMs.title", value: "Duración (ms)" }
    ,{ locale: "es", key: "entity.responses.field.body.title", value: "Respuesta" }
  ]);

  const featuredBooks = [
    { title: "  The Left Hand of Darkness  ", author: " Ursula K. Le Guin ", isbn: "978-0441478125", copiesTotal: 2 },
    { title: "Kindred", author: "Octavia E. Butler", isbn: "978-0807083697", copiesTotal: 1 },
    { title: "The Dispossessed", author: "Ursula K. Le Guin", isbn: "978-0061054884", copiesTotal: 3 }
  ];
  const generatedBooks = Array.from({ length: 97 }, (_, index) => ({ title: `Library sample ${index + 4}`, author: `Sample author ${index + 1}`, isbn: `978-000${String(index + 4).padStart(6, "0")}`, copiesTotal: (index % 4) + 1 }));
  const books = (await request("POST", "/v1/library/books", [...featuredBooks, ...generatedBooks])).items;
  const featuredMembers = [
    { name: " Ana Torres ", email: " ANA.TORRES@EXAMPLE.COM " },
    { name: " Mateo Rios ", email: " MATEO.RIOS@EXAMPLE.COM " },
    { name: " Sofia Perez ", email: " SOFIA.PEREZ@EXAMPLE.COM " }
  ];
  const generatedMembers = Array.from({ length: 21 }, (_, index) => ({ name: `Library member ${index + 4}`, email: `member${index + 4}@library.example` }));
  const members = (await request("POST", "/v1/library/members", [...featuredMembers, ...generatedMembers])).items;
  await request("POST", "/v1/library/loans", { book: books[0].id, member: members[0].id, borrowedAt: "2026-10-05T10:00:00.000Z", dueAt: "2026-10-19T23:59:59.000Z" });
  await request("POST", "/v1/library/loans", { book: books[0].id, member: members[1].id, borrowedAt: "2026-10-06T10:00:00.000Z", dueAt: "2026-10-20T23:59:59.000Z" });
  const returned = await request("POST", "/v1/library/loans", { book: books[1].id, member: members[2].id, borrowedAt: "2026-09-20T10:00:00.000Z", dueAt: "2026-10-04T23:59:59.000Z" });
  await request("PATCH", `/v1/library/loans/${returned.id}`, { status: "returned", returnedAt: "2026-10-02T16:30:00.000Z" });
  if (withPermissions) await installPermissions();
  console.log(`Library lab${withPermissions ? " with permissions" : ""} installed at ${baseUrl}: ${books.length} books, ${members.length} members, 3 loans.`);
}

install().catch((error) => { console.error(error); process.exitCode = 1; });
