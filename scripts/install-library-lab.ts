const baseUrl = process.argv[2] ?? process.env.EXENSIAL_URL ?? "http://localhost:3000";

async function request(method: string, path: string, body?: unknown): Promise<any> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = response.status === 204 ? undefined : await response.json();
  if (!response.ok) throw new Error(`${method} ${path}: ${data?.error ?? response.statusText}`);
  return data;
}

const booksDefinition = String.raw`type Book = {
  /** @exensial.title en Title */
  title: string;
  author: string;
  isbn: string;
  /** @exensial.ui.control number */
  copiesTotal: number;
  /**
   * @exensial.title en Available copies
   * @exensial.ui.control number
   */
  copiesAvailable?: number;
}`;

const membersDefinition = String.raw`type Member = {
  name: string;
  /** @exensial.ui.control email */
  email: string;
  active?: boolean;
}`;

const loansDefinition = String.raw`type Loan = {
  /** @exensial.relation library/books label=title */
  bookId: string;
  /** @exensial.relation library/members label=name */
  memberId: string;
  /** @exensial.ui.control datetime */
  borrowedAt: string;
  /** @exensial.ui.control datetime */
  dueAt: string;
  /** @exensial.ui.control datetime */
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
    for (const field of ["bookId", "memberId", "borrowedAt", "dueAt"]) if (!String(loan[field] ?? "").trim()) context.fail(field + " is required");
    const books = context.collection("books", "library"), members = context.collection("members", "library");
    const book = books.get(String(loan.bookId)), member = members.get(String(loan.memberId));
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
    const books = context.collection("books", "library"), book = books.get(String(loan.bookId));
    const available = Number(book.copiesAvailable) + 1;
    if (available > Number(book.copiesTotal)) context.fail("copiesAvailable cannot exceed copiesTotal");
    await books.update(book.id, { copiesAvailable: available });
  },
  delete: async (context, next) => { if (context.current.status === "active") context.fail("Active loans cannot be deleted"); await next(); },
  bulkCreate: async (context) => context.fail("Bulk loans are not allowed")
};`;

async function resetLibrary(): Promise<void> {
  const entities = await request("GET", "/v1/entities") as Array<{ id: string; name: string; namespace?: string }>;
  for (const entity of entities.filter((item) => item.namespace === "library" && ["loans", "members", "books"].includes(item.name))) {
    await request("DELETE", `/v1/entities/${entity.id}`);
  }
}

async function install(): Promise<void> {
  await resetLibrary();
  await request("POST", "/v1/entities", { name: "books", namespace: "library", definition: booksDefinition, code: booksCode });
  await request("POST", "/v1/entities", { name: "members", namespace: "library", definition: membersDefinition, code: membersCode });
  await request("POST", "/v1/entities", { name: "loans", namespace: "library", definition: loansDefinition, code: loansCode });

  const books = (await request("POST", "/v1/library/books", [
    { title: "  The Left Hand of Darkness  ", author: " Ursula K. Le Guin ", isbn: "978-0441478125", copiesTotal: 2 },
    { title: "Kindred", author: "Octavia E. Butler", isbn: "978-0807083697", copiesTotal: 1 },
    { title: "The Dispossessed", author: "Ursula K. Le Guin", isbn: "978-0061054884", copiesTotal: 3 }
  ])).items;
  const members = (await request("POST", "/v1/library/members", [
    { name: " Ana Torres ", email: " ANA.TORRES@EXAMPLE.COM " },
    { name: " Mateo Rios ", email: " MATEO.RIOS@EXAMPLE.COM " },
    { name: " Sofia Perez ", email: " SOFIA.PEREZ@EXAMPLE.COM " }
  ])).items;
  await request("POST", "/v1/library/loans", { bookId: books[0].id, memberId: members[0].id, borrowedAt: "2026-10-05T10:00:00.000Z", dueAt: "2026-10-19T23:59:59.000Z" });
  await request("POST", "/v1/library/loans", { bookId: books[0].id, memberId: members[1].id, borrowedAt: "2026-10-06T10:00:00.000Z", dueAt: "2026-10-20T23:59:59.000Z" });
  const returned = await request("POST", "/v1/library/loans", { bookId: books[1].id, memberId: members[2].id, borrowedAt: "2026-09-20T10:00:00.000Z", dueAt: "2026-10-04T23:59:59.000Z" });
  await request("PATCH", `/v1/library/loans/${returned.id}`, { status: "returned", returnedAt: "2026-10-02T16:30:00.000Z" });
  console.log(`Library lab installed at ${baseUrl}: ${books.length} books, ${members.length} members, 3 loans.`);
}

install().catch((error) => { console.error(error); process.exitCode = 1; });
