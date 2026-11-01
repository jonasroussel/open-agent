/** The admin's settings, as text by key; a missing key means the default. */
export interface SettingsRepository {
  all(): Promise<Map<string, string>>;
  /** `null` removes the key: the default applies again. */
  set(key: string, value: string | null, now: Date): Promise<void>;
}
