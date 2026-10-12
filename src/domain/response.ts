/** Transport-neutral result produced by the domain pipeline. */
export interface DomainResponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}
