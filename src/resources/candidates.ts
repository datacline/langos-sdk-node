import { APIResource } from './base.js';
import { fetchPage } from '../core/pagination.js';
import { candidateCreateToWire, candidateFromWire } from '../core/transform.js';
import type {
  AsyncIterablePage,
  Candidate,
  CandidateCreateParams,
  CandidateListParams,
  RequestOptions,
} from '../types.js';

export class CandidatesResource extends APIResource {
  list(
    params: CandidateListParams = {},
    options?: RequestOptions,
  ): Promise<AsyncIterablePage<Candidate>> {
    return fetchPage(
      cursor =>
        this.get('/candidates', {
          limit: params.limit,
          cursor: cursor ?? params.cursor,
          status: params.status,
          assessment_id: params.assessmentId,
        }, options),
      candidateFromWire,
    );
  }

  async retrieve(id: string, options?: RequestOptions): Promise<Candidate> {
    const w = await this.get<any>(`/candidates/${encodeURIComponent(id)}`, undefined, options);
    return candidateFromWire(w);
  }

  async create(params: CandidateCreateParams, options?: RequestOptions): Promise<Candidate> {
    const w = await this.post<any>('/candidates', candidateCreateToWire(params), options);
    return candidateFromWire(w);
  }

  /** Idempotent — calling twice on a cancelled candidate returns the same record. */
  async cancel(id: string, options?: RequestOptions): Promise<Candidate> {
    const w = await this.delete<any>(`/candidates/${encodeURIComponent(id)}`, options);
    return candidateFromWire(w);
  }
}
