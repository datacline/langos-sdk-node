import { APIResource } from './base.js';
import { fetchPage } from '../core/pagination.js';
import { challengeFromWire } from '../core/transform.js';
import type { WireChallenge } from '../core/transform.js';
import type {
  Challenge,
  ChallengeListParams,
  AsyncIterablePage,
  RequestOptions,
} from '../types.js';

interface WireListResponse<T> {
  object: 'list';
  data: T[];
  has_more: boolean;
  next_cursor: string | null;
}

export class ChallengesResource extends APIResource {
  list(
    params: ChallengeListParams = {},
    options?: RequestOptions,
  ): Promise<AsyncIterablePage<Challenge>> {
    return fetchPage(
      cursor =>
        this.get<WireListResponse<WireChallenge>>(
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
    const w = await this.get<WireChallenge>(
      `/challenges/${encodeURIComponent(id)}`,
      undefined,
      options,
    );
    return challengeFromWire(w);
  }
}
