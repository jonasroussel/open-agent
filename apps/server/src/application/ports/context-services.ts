import type { WeatherOutput } from '@open-agent/shared';

/**
 * A tool's refusal, with a message for the model (and kept with the call, so the model reads it again later). Any
 * other error is hidden as a failure, since it may say more than the model needs.
 */
export class ToolRefusal extends Error {}

/** Exact arithmetic for the model, which guesses sums instead of computing them. */
export interface Calculator {
  /** The result as text. Throws `CalculationError` with a message the model can act on. */
  evaluate(expression: string): string;
}

export class CalculationError extends ToolRefusal {}

export type WebPage = { url: string; title: string | null; text: string };

/** A page the user named, read as plain text. */
export interface WebPageReader {
  /** Throws `PageUnavailable` with a message the model can pass on. */
  read(url: string, abortSignal: AbortSignal): Promise<WebPage>;
}

export class PageUnavailable extends ToolRefusal {}

export interface WeatherService {
  /** `days`: from today, 1 to 7. Throws `PlaceNotFound` when the place does not exist. */
  forecast(place: string, days: number, locale: string, abortSignal: AbortSignal): Promise<WeatherOutput>;
}

export class PlaceNotFound extends ToolRefusal {}
