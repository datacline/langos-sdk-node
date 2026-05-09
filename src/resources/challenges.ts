import { APIResource } from './base.js';
import { fetchPage } from '../core/pagination.js';
import { challengeFromWire } from '../core/transform.js';
import type {
  Challenge,
  ChallengeListParams,
  AsyncIterablePage,
  RequestOptions,
} from '../types.js';

export class ChallengesResource extends APIResource {
  list(
    params: ChallengeListParams = {},
    options?: RequestOptions,
  ): Promise<AsyncIterablePage<Challenge>> {
    return fetchPage(
      cursor =>
        this.get<{ object: 'list'; data: any[]; has_more: boolean; next_cursor: string | null }>(
          '/challenges',
          {
            limit: params.limit,
            cursor: cursor ?? params.cursor,
            status: params.status,
            language: params.language,
          },
          options,
        ),
      challengeFromWire,
    );
  }

  async retrieve(id: string, options?: RequestOptions): Promise<Challenge> {
    const w = await this.get<any>(`/challenges/${encodeURIComponent(id)}`, undefined, options);
    return challengeFromWire(w);
  }
}
