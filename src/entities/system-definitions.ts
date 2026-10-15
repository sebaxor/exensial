export interface SystemDefinitionRecord {
  name: string;
  definition: string;
  version: string;
  namespace?: string;
  group?: string;
  icon?: string;
  code?: string;
}

/**
 * Design-time seed data for the minimum Exensial platform. At startup these
 * records are inserted into `entities`, then parsed and installed exactly like
 * definitions received through POST /v1/entities.
 */
export const systemDefinitionRecords: SystemDefinitionRecord[] = [
  {
    name: "localizations", version: "1.0.0", group: "System", icon: "language,🌐",
    definition: String.raw`/**
 * @exensial.title en Localization catalog
 * @exensial.title es Catálogo de localizaciones
 * @exensial.description en Runtime translations for OpenAPI metadata and the generic console.
 * @exensial.description es Traducciones en tiempo de ejecución para los metadatos OpenAPI y la consola genérica.
 */
type Localization = {
  /** @exensial.title en Language
   * @exensial.title es Idioma
   * @exensial.ui.searchable
   * @exensial.ui.filterable */
  locale: string;
  /** @exensial.title en Translation key
   * @exensial.title es Clave de traducción
   * @exensial.ui.searchable
   * @exensial.ui.filterable */
  key: string;
  /** @exensial.title en Translated text
   * @exensial.title es Texto traducido
   * @exensial.ui.control textarea */
  value: string;
}`
  },
  {
    name: "requests", version: "1.0.0", group: "System", icon: "inbox,📥",
    definition: String.raw`/**
 * @exensial.title en Request journal
 * @exensial.title es Registro de solicitudes
 * @exensial.description en Normalized inbound API requests captured for auditing and diagnostics.
 * @exensial.description es Solicitudes de API entrantes normalizadas, capturadas para auditoría y diagnóstico.
 */
type RequestJournal = {
  /** @exensial.title en API version
   * @exensial.title es Versión de API */
  apiVersion: string;
  /** @exensial.title en Received at
   * @exensial.title es Recibida el
   * @exensial.ui.control datetime */
  receivedAt: string;
  /** @exensial.title en Namespace
   * @exensial.title es Espacio de nombres */
  namespace?: string;
  /** @exensial.title en Entity
   * @exensial.title es Entidad */
  entityName: string;
  /** @exensial.title en Operation
   * @exensial.title es Operación */
  action: string;
  /** @exensial.ui.hidden */
  requestItemId?: string;
  /** @exensial.ui.tableHidden */
  payload?: json;
}`
  },
  {
    name: "responses", version: "1.0.0", group: "System", icon: "reply,📤",
    definition: String.raw`/**
 * @exensial.title en Response journal
 * @exensial.title es Registro de respuestas
 * @exensial.description en Normalized API responses with completion time and duration.
 * @exensial.description es Respuestas de API normalizadas con hora de finalización y duración.
 */
type ResponseJournal = {
  /** @exensial.title en HTTP status
   * @exensial.title es Estado HTTP */
  status: number;
  /** @exensial.title en Completed at
   * @exensial.title es Completada el
   * @exensial.ui.control datetime */
  completedAt: string;
  /** @exensial.title en Duration (ms)
   * @exensial.title es Duración (ms)
   * @exensial.ui.control number */
  durationMs: number;
  /** @exensial.ui.tableHidden */
  body?: json;
}`
  },
  {
    name: "roles", version: "1.0.0", group: "System", icon: "shield,🛡",
    definition: String.raw`/**
 * @exensial.title en Roles
 * @exensial.title es Roles
 * @exensial.description en Named collections of endpoint permissions.
 * @exensial.description es Conjuntos nombrados de permisos de endpoints.
 */
type Role = {
  /** @exensial.title en Role name
   * @exensial.title es Nombre del rol
   * @exensial.ui.searchable */
  name: string;
  /** @exensial.title en Description
   * @exensial.title es Descripción */
  description?: string;
}`
  },
  {
    name: "users", version: "1.0.0", group: "System", icon: "user,👤",
    definition: String.raw`/**
 * @exensial.title en Users
 * @exensial.title es Usuarios
 * @exensial.description en Local identities. Password hashes are never exposed through REST.
 * @exensial.description es Identidades locales. Los hashes de contraseña nunca se exponen por REST.
 */
type User = {
  /** @exensial.title en Username
   * @exensial.title es Usuario
   * @exensial.ui.searchable */
  username: string;
  /** @exensial.title en Email
   * @exensial.title es Correo electrónico
   * @exensial.ui.control email
   * @exensial.ui.searchable */
  email?: string;
  /** @exensial.title en Initial password
   * @exensial.title es Contraseña inicial
   * @exensial.ui.control password
   * @exensial.ui.sensitive */
  password?: string;
  /** @exensial.ui.hidden
   * @exensial.ui.sensitive */
  passwordHash?: string;
  /** @exensial.ui.hidden */
  roles: json;
  /** @exensial.title en Active
   * @exensial.title es Activo
   * @exensial.default true */
  active: boolean;
}`
  },
  {
    name: "userRoles", version: "1.0.0", group: "System", icon: "users,👥",
    definition: String.raw`/**
 * @exensial.title en User roles
 * @exensial.title es Roles de usuario
 * @exensial.description en Many-to-many assignments between users and roles.
 * @exensial.description es Asignaciones muchos-a-muchos entre usuarios y roles.
 */
type UserRole = {
  /** @exensial.title en User
   * @exensial.title es Usuario
   * @exensial.relation users label=username */
  user: User;
  /** @exensial.title en Role
   * @exensial.title es Rol
   * @exensial.relation roles label=name */
  role: Role;
}`
  },
  {
    name: "permissions", version: "1.0.0", group: "System", icon: "key,🔑",
    definition: String.raw`/**
 * @exensial.title en Endpoint permissions
 * @exensial.title es Permisos de endpoints
 * @exensial.description en Allow or deny a role access to an HTTP method and path.
 * @exensial.description es Permite o deniega a un rol acceso a un método y ruta HTTP.
 */
type EndpointPermission = {
  /** @exensial.title en Role
   * @exensial.title es Rol
   * @exensial.relation roles label=name */
  role: Role;
  /** @exensial.title en HTTP method
   * @exensial.title es Método HTTP
   * @exensial.ui.searchable */
  method: string;
  /** @exensial.title en Path pattern
   * @exensial.title es Patrón de ruta
   * @exensial.ui.searchable */
  path: string;
  /** @exensial.title en Permission decision
   * @exensial.title es Decisión de permiso
   * @exensial.description en Whether this rule grants or rejects access.
   * @exensial.description es Si esta regla concede o rechaza el acceso.
   * @exensial.enum allow deny */
  decision: string;
}`
  },
  {
    name: "views", version: "1.0.0", group: "System", icon: "table,▦",
    definition: String.raw`/**
 * @exensial.title en Views
 * @exensial.title es Vistas
 * @exensial.description en Persisted query and detail views installed at runtime.
 * @exensial.description es Vistas de consulta y detalle persistidas e instaladas en tiempo de ejecución.
 */
type View = {
  /** @exensial.title en View ID
   * @exensial.title es ID de vista
   * @exensial.ui.searchable */
  viewId: string;
  /** @exensial.title en Kind
   * @exensial.title es Tipo
   * @exensial.enum query detail */
  kind: string;
  /** @exensial.title en Name
   * @exensial.title es Nombre */
  name: string;
  /** @exensial.ui.tableHidden */
  source?: json;
  /** @exensial.ui.tableHidden */
  target?: json;
  /** @exensial.ui.tableHidden */
  columns?: json;
  /** @exensial.ui.tableHidden */
  fields?: json;
}`
  },
  {
    name: "menus", version: "1.0.0", group: "System", icon: "menu,☰",
    definition: String.raw`/**
 * @exensial.title en Menus
 * @exensial.title es Menús
 * @exensial.description en Runtime menu entries that point to implicit or persisted views.
 * @exensial.description es Opciones de menú en tiempo de ejecución que apuntan a vistas implícitas o persistidas.
 */
type Menu = {
  /** @exensial.title en Menu ID
   * @exensial.title es ID de menú
   * @exensial.ui.searchable */
  menuId: string;
  parentId?: string;
  /** @exensial.default 0 */
  position?: number;
  /** @exensial.default true */
  visible: boolean;
  icon?: string;
  /** @exensial.title en View ID
   * @exensial.title es ID de vista */
  viewId: string;
}`
  },
  {
    name: "useCases", version: "1.0.0", group: "System", icon: "play,▶",
    definition: String.raw`/**
 * @exensial.title en Use cases
 * @exensial.title es Casos de uso
 * @exensial.description en Runtime business operations over typed entity record inputs.
 * @exensial.description es Operaciones de negocio en tiempo de ejecución sobre entradas tipadas de registros de entidad.
 */
type UseCase = {
  /** @exensial.ui.searchable */
  useCaseId: string;
  name: string;
  description?: string;
  icon?: string;
  /** @exensial.ui.tableHidden */
  route: json;
  /** @exensial.ui.tableHidden */
  inputs: json;
  /** @exensial.ui.tableHidden */
  parameters?: json;
  /** @exensial.ui.tableHidden */
  enableCondition?: json;
  /** @exensial.ui.control textarea
   * @exensial.ui.codeLanguage typescript
   * @exensial.ui.tableHidden */
  code: string;
}`
  }
];
