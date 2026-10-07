export interface GuideFact {
  id: string;
  text: { en: string; de: string };
  source: { url: string; publisher: string; title: string };
  /** YYYY-MM-DD, the day a person read the source. */
  verifiedOn: string;
}

export interface PlatformGuide {
  platform: 'x' | 'instagram';
  startUrl: GuideFact;
  steps: GuideFact[];
  options: GuideFact[];
  waiting: GuideFact & { typicalDays: { min: number; max: number } | null };
  downloadWindow: GuideFact & { days: number | null };
  htmlExportHint: GuideFact;
}
