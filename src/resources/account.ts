import { APIResource } from './base.js';
import {
  accountFromWire,
  webhookEndpointFromWire,
  webhookEndpointParamsToWire,
} from '../core/transform.js';
import type {
  Account,
  RequestOptions,
  WebhookEndpoint,
  WebhookEndpointParams,
} from '../types.js';

/**
 * `client.account` — read the company info that owns this integration, and
 * manage the outbound webhook endpoint.
 *
 *  Typical usage:
 *
 *  ```ts
 *  const account = await client.account.retrieve();
 *  if (account.sessionsRemaining === 0) {
 *    showUpgradePrompt();
 *  }
 *
 *  await client.account.setWebhookEndpoint({
 *    webhookUrl: 'https://greenhouse.example.com/webhooks/langos',
 *    rotateSigningSecret: true,
 *  });
 *  ```
 */
export class AccountResource extends APIResource {
  /**
   * Read the calling integration's account.
   *
   *  Includes plan, quota, feature flags, and integration metadata
   *  (key prefix, scopes, rate limit, webhook URL).
   *
   * @returns {Promise<Account>}
   */
  async retrieve(options?: RequestOptions): Promise<Account> {
    const w = await this.get<any>('/account', undefined, options);
    return accountFromWire(w);
  }

  /**
   * Set or clear the outbound webhook URL, and optionally rotate the signing
   * secret.
   *
   *  When `rotateSigningSecret: true`, the response includes the new secret in
   *  `signingSecret`. Store it — the secret cannot be re-fetched. Subsequent
   *  reads return `signingSecret: null`.
   *
   * @param {WebhookEndpointParams} params
   */
  async setWebhookEndpoint(
    params: WebhookEndpointParams,
    options?: RequestOptions,
  ): Promise<WebhookEndpoint> {
    const body = webhookEndpointParamsToWire(params);
    const w = await this.patch<any>('/account/webhook-endpoint', body, options);
    return webhookEndpointFromWire(w);
  }
}
