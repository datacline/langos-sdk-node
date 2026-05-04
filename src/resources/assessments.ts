import { APIResource } from './base.js';
import { fetchPage } from '../core/pagination.js';
import { assessmentFromWire } from '../core/transform.js';
import type {
  Assessment,
  AssessmentListParams,
  AsyncIterablePage,
  RequestOptions,
} from '../types.js';

export class AssessmentsResource extends APIResource {
  list(
    params: AssessmentListParams = {},
    options?: RequestOptions,
  ): Promise<AsyncIterablePage<Assessment>> {
    return fetchPage(
      cursor =>
        this.get<{ object: 'list'; data: any[]; has_more: boolean; next_cursor: string | null }>(
          '/assessments',
          { limit: params.limit, cursor: cursor ?? params.cursor },
          options,
        ),
      assessmentFromWire,
    );
  }

  async retrieve(id: string, options?: RequestOptions): Promise<Assessment> {
    const w = await this.get<any>(`/assessments/${encodeURIComponent(id)}`, undefined, options);
    return assessmentFromWire(w);
  }
}
