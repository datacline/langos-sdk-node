import type { ResolvedClientConfig } from '../core/request.js';
import { makeRequest } from '../core/request.js';
import type { RequestOptions } from '../types.js';

export class APIResource {
  protected readonly cfg: ResolvedClientConfig;

  constructor(cfg: ResolvedClientConfig) {
    this.cfg = cfg;
  }

  protected get<T>(
    path: string,
    query?: Record<string, string | number | undefined | null>,
    options?: RequestOptions,
  ): Promise<T> {
    return makeRequest<T>(this.cfg, { method: 'GET', path, query, options });
  }

  protected post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return makeRequest<T>(this.cfg, { method: 'POST', path, body, options });
  }

  protected delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return makeRequest<T>(this.cfg, { method: 'DELETE', path, options });
  }

  protected patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return makeRequest<T>(this.cfg, { method: 'PATCH', path, body, options });
  }
}
