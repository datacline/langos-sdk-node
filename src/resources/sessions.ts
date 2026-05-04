import { APIResource } from './base.js';
import { fetchPage } from '../core/pagination.js';
import { sessionFromWire } from '../core/transform.js';
import type {
  AsyncIterablePage,
  RequestOptions,
  Session,
  SessionListParams,
} from '../types.js';

export class SessionsResource extends APIResource {
  async retrieve(id: string, options?: RequestOptions): Promise<Session> {
    const w = await this.get<any>(`/sessions/${encodeURIComponent(id)}`, undefined, options);
    return sessionFromWire(w);
  }

  listForCandidate(
    candidateId: string,
    params: SessionListParams = {},
    options?: RequestOptions,
  ): Promise<AsyncIterablePage<Session>> {
    return fetchPage(
      cursor =>
        this.get(
          `/candidates/${encodeURIComponent(candidateId)}/sessions`,
          { limit: params.limit, cursor: cursor ?? params.cursor },
          options,
        ),
      sessionFromWire,
    );
  }
}
