import { hashPassword } from "../src/application/security";

const withPermissions = process.argv.includes("--permissions");
const baseUrl = process.argv.find((argument) => argument.startsWith("http")) ?? process.env.EXENSIAL_URL ?? "http://localhost:3000";
let accessToken: string | undefined;
const labUiKeys = new Set(["consoleHint", "language", "rows", "newRecord", "new", "save", "cancel", "close", "actions", "edit", "delete", "previous", "next", "page", "of", "records", "select", "filter", "matchingRecords", "noRecords", "noMatches", "find", "noRecordSelected", "saved", "deleted", "group.Library", "group.System"].map((key) => `ui.${key}`));

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
   * @exensial.ui.control number */
  copiesTotal: number;
  /**
   * @exensial.title en Available copies
   * @exensial.title es Copias disponibles
   * @exensial.ui.control number
   */
  copiesAvailable?: number;
}`;

const membersDefinition = String.raw`/**
 * @exensial.title en Library members
 * @exensial.title es Miembros
 * @exensial.description en People who can borrow books from the library.
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
  /** @exensial.title en Active
   * @exensial.title es Activo */
  active?: boolean;
}`;

const loansDefinition = String.raw`/**
 * @exensial.title en Book loans
 * @exensial.title es Préstamos
 * @exensial.description en Circulation records for borrowed and returned books.
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
   * @exensial.ui.control datetime */
  borrowedAt: string;
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
  if (!book.title || !book.author || !book.isbn) fail("Book title, author, and isbn are required");
  if (!Number.isInteger(book.copiesTotal) || book.copiesTotal < 1) fail("copiesTotal must be a positive integer");
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
      if (!Number.isInteger(change.copiesTotal) || change.copiesTotal < 1) context.fail("copiesTotal must be a positive integer");
      const borrowed = Number(current.copiesTotal) - Number(current.copiesAvailable);
      if (Number(change.copiesTotal) < borrowed) context.fail("copiesTotal cannot be lower than borrowed copies");
      change.copiesAvailable = Number(change.copiesTotal) - borrowed;
    }
    await next();
  }
};`;

const membersCode = String.raw`
function prepare(member, fail) {
  member.name = String(member.name ?? "").trim();
  member.email = String(member.email ?? "").trim().toLowerCase();
  if (!member.name || !member.email.includes("@")) fail("A name and valid email are required");
  member.active = true;
}
export default {
  create: async (context, next) => { prepare(context.input, context.fail); await next(); },
  bulkCreate: async (context, next) => { for (const member of context.input) prepare(member, context.fail); await next(); },
  update: async (context, next) => {
    const member = context.input;
    if ("name" in member) member.name = String(member.name).trim();
    if ("email" in member) { member.email = String(member.email).trim().toLowerCase(); if (!member.email.includes("@")) context.fail("A valid email is required"); }
    await next();
  }
};`;

const loansCode = String.raw`
const isDate = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));
export default {
  create: async (context, next) => {
    const loan = context.input;
    for (const field of ["book", "member", "borrowedAt", "dueAt"]) if (!String(loan[field] ?? "").trim()) context.fail(field + " is required");
    const books = context.collection("books", "library"), members = context.collection("members", "library");
    const book = books.get(String(loan.book)), member = members.get(String(loan.member));
    if (!member?.active) context.fail("Member is not active");
    if (!book || Number(book.copiesAvailable) < 1) context.fail("Book is not available");
    if (!isDate(loan.borrowedAt) || !isDate(loan.dueAt) || Date.parse(loan.dueAt) <= Date.parse(loan.borrowedAt)) context.fail("A later valid dueAt is required");
    await books.update(book.id, { copiesAvailable: Number(book.copiesAvailable) - 1 });
    try { delete loan.returnedAt; loan.status = "active"; await next(); }
    catch (error) { await books.update(book.id, { copiesAvailable: Number(book.copiesAvailable) }); throw error; }
  },
  update: async (context, next) => {
    const loan = context.current, change = context.input;
    if (loan.status !== "active" || change.status !== "returned" || !isDate(change.returnedAt)) context.fail("Only an active loan with returnedAt may be returned");
    await next();
    const books = context.collection("books", "library"), book = books.get(String(loan.book));
    const available = Number(book.copiesAvailable) + 1;
    if (available > Number(book.copiesTotal)) context.fail("copiesAvailable cannot exceed copiesTotal");
    await books.update(book.id, { copiesAvailable: available });
  },
  delete: async (context, next) => { if (context.current.status === "active") context.fail("Active loans cannot be deleted"); await next(); },
  bulkCreate: async (context) => context.fail("Bulk loans are not allowed")
};`;

async function resetLibrary(): Promise<void> {
  await signInIfPresent();
  if (withPermissions) {
    for (const entity of ["permissions", "users", "roles"]) {
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
  for (const entry of localizations.filter((item) => item.key.startsWith("entity.library.") || (item.locale === "es" && labUiKeys.has(item.key)))) await request("DELETE", `/v1/localizations/${entry.id}`);
}

async function installPermissions(): Promise<void> {
  await request("POST", "/v1/roles", [
    { name: "library-reader", description: "Reads the public book catalog." },
    { name: "library-admin", description: "Administers the library and Exensial system catalogs." }
  ]);
  await request("POST", "/v1/users", [
    { username: "reader", passwordHash: hashPassword("reader123"), roles: ["library-reader"], active: true },
    { username: "admin", passwordHash: hashPassword("admin123"), roles: ["library-admin"], active: true }
  ]);
  const protectedPaths = ["/v1/library/members*", "/v1/library/loans*", "/v1/entities*", "/v1/localizations*", "/v1/requests*", "/v1/responses*", "/v1/roles*", "/v1/users*", "/v1/permissions*"];
  const permissions = [
    { role: "anonymous", method: "GET", path: "/v1/library/books*", effect: "allow" },
    { role: "library-reader", method: "GET", path: "/v1/*", effect: "allow" },
    ...["POST", "PUT", "PATCH", "DELETE"].map((method) => ({ role: "library-admin", method, path: "/v1/library/books*", effect: "allow" })),
    ...protectedPaths.map((path) => ({ role: "library-admin", method: "*", path, effect: "allow" }))
  ];
  await request("POST", "/v1/permissions", permissions);
}

async function install(): Promise<void> {
  await resetLibrary();
  await request("POST", "/v1/entities", { name: "books", version: "1.0.0", namespace: "library", group: "Library", definition: booksDefinition, code: booksCode });
  await request("POST", "/v1/entities", { name: "members", version: "1.0.0", namespace: "library", group: "Library", definition: membersDefinition, code: membersCode });
  await request("POST", "/v1/entities", { name: "loans", version: "1.0.0", namespace: "library", group: "Library", definition: loansDefinition, code: loansCode });
  await request("POST", "/v1/localizations", [
    { locale: "es", key: "ui.consoleHint", value: "Consola de entidades en tiempo de ejecución" },
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
    { locale: "es", key: "ui.previous", value: "Anterior" },
    { locale: "es", key: "ui.next", value: "Siguiente" },
    { locale: "es", key: "ui.page", value: "Página" },
    { locale: "es", key: "ui.of", value: "de" },
    { locale: "es", key: "ui.records", value: "registros" },
    { locale: "es", key: "ui.select", value: "Seleccionar" },
    { locale: "es", key: "ui.filter", value: "Filtrar" },
    { locale: "es", key: "ui.matchingRecords", value: "registros coincidentes" },
    { locale: "es", key: "ui.noRecords", value: "Aún no hay registros." },
    { locale: "es", key: "ui.noMatches", value: "No hay registros coincidentes." },
    { locale: "es", key: "ui.find", value: "Buscar" },
    { locale: "es", key: "ui.noRecordSelected", value: "No se ha seleccionado un registro" },
    { locale: "es", key: "ui.saved", value: "Guardado." },
    { locale: "es", key: "ui.deleted", value: "Eliminado." },
    { locale: "es", key: "ui.group.Library", value: "Biblioteca" },
    { locale: "es", key: "ui.group.System", value: "Sistema" },
    { locale: "es", key: "entity.library.books.title", value: "Libros" },
    { locale: "es", key: "entity.library.members.title", value: "Miembros" },
    { locale: "es", key: "entity.library.loans.title", value: "Préstamos" },
    { locale: "es", key: "entity.library.books.field.title.title", value: "Título" },
    { locale: "es", key: "entity.library.books.field.copiesAvailable.title", value: "Copias disponibles" },
    { locale: "es", key: "entity.library.loans.field.book.title", value: "Libro" },
    { locale: "es", key: "entity.library.loans.field.member.title", value: "Miembro" }
  ]);

  const featuredBooks = [
    { title: "  The Left Hand of Darkness  ", author: " Ursula K. Le Guin ", isbn: "978-0441478125", copiesTotal: 2 },
    { title: "Kindred", author: "Octavia E. Butler", isbn: "978-0807083697", copiesTotal: 1 },
    { title: "The Dispossessed", author: "Ursula K. Le Guin", isbn: "978-0061054884", copiesTotal: 3 }
  ];
  const generatedBooks = Array.from({ length: 97 }, (_, index) => ({ title: `Library sample ${index + 4}`, author: `Sample author ${index + 1}`, isbn: `978-000${String(index + 4).padStart(6, "0")}`, copiesTotal: (index % 4) + 1 }));
  const books = (await request("POST", "/v1/library/books", [...featuredBooks, ...generatedBooks])).items;
  const members = (await request("POST", "/v1/library/members", [
    { name: " Ana Torres ", email: " ANA.TORRES@EXAMPLE.COM " },
    { name: " Mateo Rios ", email: " MATEO.RIOS@EXAMPLE.COM " },
    { name: " Sofia Perez ", email: " SOFIA.PEREZ@EXAMPLE.COM " }
  ])).items;
  await request("POST", "/v1/library/loans", { book: books[0].id, member: members[0].id, borrowedAt: "2026-10-05T10:00:00.000Z", dueAt: "2026-10-19T23:59:59.000Z" });
  await request("POST", "/v1/library/loans", { book: books[0].id, member: members[1].id, borrowedAt: "2026-10-06T10:00:00.000Z", dueAt: "2026-10-20T23:59:59.000Z" });
  const returned = await request("POST", "/v1/library/loans", { book: books[1].id, member: members[2].id, borrowedAt: "2026-09-20T10:00:00.000Z", dueAt: "2026-10-04T23:59:59.000Z" });
  await request("PATCH", `/v1/library/loans/${returned.id}`, { status: "returned", returnedAt: "2026-10-02T16:30:00.000Z" });
  if (withPermissions) await installPermissions();
  console.log(`Library lab${withPermissions ? " with permissions" : ""} installed at ${baseUrl}: ${books.length} books, ${members.length} members, 3 loans.`);
}

install().catch((error) => { console.error(error); process.exitCode = 1; });
