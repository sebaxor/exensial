import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { type EntityModule, type EntityRuntime, ValidationError } from "./entity-runtime";

export class UnauthorizedError extends Error {}
export class ForbiddenError extends Error {}

export type SecurityPrincipal = { id: string; username: string; roles: string[] };

/** System entities are regular runtime repositories; the HTTP policy layer reads them declaratively. */
export const securityModules: EntityModule[] = [
  { definition: { name: "roles", context: { version: "1.0.0", group: "System", icon: "shield,🛡" }, documentation: { title: { en: "Roles" }, description: { en: "Named collections of endpoint permissions." } }, fields: { name: { type: "string", required: true, documentation: { title: { en: "Role name" } }, ui: { searchable: true } }, description: { type: "string", required: false, documentation: { title: { en: "Description" } } } } } },
  { definition: { name: "users", context: { version: "1.0.0", group: "System", icon: "user,👤" }, documentation: { title: { en: "Users" }, description: { en: "Local identities. Password hashes are never exposed through REST." } }, fields: { username: { type: "string", required: true, documentation: { title: { en: "Username" } }, ui: { searchable: true } }, email: { type: "string", required: false, documentation: { title: { en: "Email" } }, ui: { control: "email", searchable: true } }, password: { type: "string", required: false, documentation: { title: { en: "Initial password" } }, ui: { control: "password", sensitive: true } }, passwordHash: { type: "string", required: false, documentation: { title: { en: "Password hash" } }, ui: { hidden: true, sensitive: true } }, roles: { type: "json", required: true, documentation: { title: { en: "Legacy roles" } }, ui: { hidden: true } }, active: { type: "boolean", required: true, documentation: { title: { en: "Active" } } } } }, lifecycle: { beforeCreate(input) { preparePassword(input, true); }, beforeUpdate(_current, next) { preparePassword(next, false); } } },
  { definition: { name: "userRoles", context: { version: "1.0.0", group: "System", icon: "users,👥" }, documentation: { title: { en: "User roles" }, description: { en: "Many-to-many assignments between users and roles." } }, fields: { user: { type: "string", required: true, documentation: { title: { en: "User" } }, ui: { relation: { entity: "users", label: "username" } } }, role: { type: "string", required: true, documentation: { title: { en: "Role" } }, ui: { relation: { entity: "roles", label: "name" } } } } } },
  { definition: { name: "permissions", context: { version: "1.0.0", group: "System", icon: "key,🔑" }, documentation: { title: { en: "Endpoint permissions" }, description: { en: "Allow or deny a role access to an HTTP method and path. A path may end in * as a wildcard." } }, fields: { role: { type: "string", required: true, documentation: { title: { en: "Role" } }, ui: { relation: { entity: "roles", label: "name" } } }, method: { type: "string", required: true, documentation: { title: { en: "HTTP method" } }, ui: { searchable: true } }, path: { type: "string", required: true, documentation: { title: { en: "Path pattern" } }, ui: { searchable: true } }, effect: { type: "string", required: true, documentation: { title: { en: "Effect" }, description: { en: "allow or deny; deny takes precedence." } } } } } }
];

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$${salt}$${scryptSync(password, salt, 32).toString("hex")}`;
}

function preparePassword(input: Record<string, unknown>, required: boolean): void {
  if ("password" in input) {
    const password = String(input.password ?? "");
    if (password.length < 8) throw new ValidationError("Password must contain at least 8 characters");
    input.passwordHash = hashPassword(password);
    delete input.password;
  }
  if (required && typeof input.passwordHash !== "string") throw new ValidationError("An initial password is required");
}

export function verifyPassword(password: string, stored: unknown): boolean {
  const [kind, salt, expected] = String(stored).split("$");
  if (kind !== "scrypt" || !salt || !expected) return false;
  const actual = scryptSync(password, salt, 32).toString("hex");
  return actual.length === expected.length && timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

export function authenticate(runtime: EntityRuntime, username: unknown, password: unknown): SecurityPrincipal {
  const user = runtime.listRecords("users").find((item) => item.username === username && item.active === true);
  if (!user || !verifyPassword(String(password ?? ""), user.passwordHash)) throw new UnauthorizedError("Invalid username or password");
  return { id: user.id, username: String(user.username), roles: rolesForUser(runtime, user) };
}

export function issueToken(principal: SecurityPrincipal, secret: string): string {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ sub: principal.id, username: principal.username, roles: principal.roles, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 8 }));
  return `${header}.${payload}.${signature(`${header}.${payload}`, secret)}`;
}

export function readToken(value: string | undefined, secret: string): SecurityPrincipal | undefined {
  if (!value?.startsWith("Bearer ")) return undefined;
  const [header, payload, received] = value.slice(7).split(".");
  if (!header || !payload || !received || signature(`${header}.${payload}`, secret) !== received) throw new UnauthorizedError("Invalid access token");
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!claims.sub || !claims.username || !Array.isArray(claims.roles) || Number(claims.exp) <= Math.floor(Date.now() / 1000)) throw new Error();
    return { id: String(claims.sub), username: String(claims.username), roles: claims.roles.filter((role: unknown): role is string => typeof role === "string") };
  } catch { throw new UnauthorizedError("Invalid or expired access token"); }
}

export function authorize(runtime: EntityRuntime, principal: SecurityPrincipal | undefined, method: string, path: string): void {
  const matches = runtime.listRecords("permissions").filter((permission) => (String(permission.method) === "*" || String(permission.method).toUpperCase() === method.toUpperCase()) && pathMatches(String(permission.path), path));
  if (!matches.length) return; // Unconfigured endpoints remain anonymous by design.
  // A public endpoint stays public when a client happens to send a valid token.
  // Authentication must add capabilities, never remove anonymous read access.
  if (matches.some((permission) => roleName(runtime, permission.role) === "anonymous" && permission.effect === "allow")) return;
  if (!principal) throw new UnauthorizedError("Authentication is required for this endpoint");
  const roleMatches = matches.filter((permission) => principal.roles.includes(roleName(runtime, permission.role)));
  if (roleMatches.some((permission) => permission.effect === "deny")) throw new ForbiddenError("Your roles are denied access to this endpoint");
  if (!roleMatches.some((permission) => permission.effect === "allow")) throw new ForbiddenError("Your roles do not grant access to this endpoint");
}

function roleName(runtime: EntityRuntime, value: unknown): string {
  const role = runtime.findRecord("roles", String(value));
  return String(role?.name ?? value);
}

function rolesForUser(runtime: EntityRuntime, user: Record<string, unknown>): string[] {
  const legacy = Array.isArray(user.roles) ? user.roles.filter((role): role is string => typeof role === "string") : [];
  const assigned = runtime.listRecords("userRoles").filter((assignment) => assignment.user === user.id).map((assignment) => roleName(runtime, assignment.role));
  return [...new Set([...legacy, ...assigned])];
}

function pathMatches(pattern: string, path: string): boolean { return pattern.endsWith("*") ? path.startsWith(pattern.slice(0, -1)) : pattern === path; }
function signature(value: string, secret: string): string { return createHmac("sha256", secret).update(value).digest("base64url"); }
function base64url(value: string): string { return Buffer.from(value).toString("base64url"); }
