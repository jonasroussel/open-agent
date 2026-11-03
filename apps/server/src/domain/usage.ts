/** What a paid call was for: the quota counts every one, the admin page splits them. */
export type UsagePurpose = 'answer' | 'pre_pass' | 'memory' | 'title' | 'web_search' | 'image';

export type UsageEvent = {
  userId: number;
  conversationId: string | null;
  purpose: UsagePurpose;
  /** The OpenRouter model id, or the search service for `web_search`. */
  model: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  /** As billed by OpenRouter, `0` for a search within a free plan; `null` when OpenRouter did not say. */
  costUsd: number | null;
  /** Billed to the user's own OpenRouter key: kept for their history, never counted against the quota. */
  paidByUser: boolean;
  at: Date;
};

export interface UsageLedger {
  record(event: UsageEvent): Promise<void>;
  /** USD the app paid for the user since `since`; events without a known cost count as 0. */
  spentSince(userId: number, since: Date): Promise<number>;
  /** The same, for everyone at once; users who spent nothing are missing. */
  spentByUserSince(since: Date): Promise<Map<number, number>>;
}
