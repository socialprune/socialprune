export interface GuideFact {
  id: string;
  text: { en: string; de: string };
  source: { url: string; publisher: string; title: string };
  /** Additional language source read for the same fact. */
  sourceDe?: { url: string; publisher: string; title: string };
  /** YYYY-MM-DD, the day the source was read or its access failure recorded. */
  retrievedOn: string;
  /** YYYY-MM-DD, the day a person checked the fact in a browser. */
  verifiedOn: string | null;
}

export interface PlatformGuide<Platform extends string = string> {
  platform: Platform;
  startUrl: GuideFact;
  steps: GuideFact[];
  options: GuideFact[];
  waiting: GuideFact & { typicalDays: { min: number; max: number } | null };
  downloadWindow: GuideFact & { days: number | null };
  htmlExportHint: GuideFact;
  /** Separate device paths, when the source distinguishes them. */
  paths?: { desktop: GuideFact[]; mobile: GuideFact[] };
}
