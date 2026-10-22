import { WorkspaceError } from './errors.ts';
import { TimeZoneSettingSchema } from './settings-schema.ts';
import type { WorkspaceStore } from './store.ts';
import { ReviewViewSchema } from '../model/index.ts';
import type { ReviewView } from '../model/index.ts';
import { CriteriaSettingsSchema, KeepRulesSchema } from '../criteria/schema.ts';
import type { CriteriaSettings, KeepRule } from '../criteria/schema.ts';
import { assertReviewSettings } from '../criteria/admission.ts';
export { storedReviewView } from './settings-schema.ts';

export interface SettingsChangeResult {
  timeZone: string | null;
  revision: number;
}

/** Neutral metadata writes only. A setting never appends a human or label event. */
export class SettingsService {
  async setCriteria(criteria: CriteriaSettings) {
    const parsed = CriteriaSettingsSchema.safeParse(criteria);
    if (!parsed.success) throw new WorkspaceError('INVALID_REQUEST');
    return this.setFeedSetting('criteria', parsed.data);
  }
  async setKeepRules(keepRules: KeepRule[]) {
    const parsed = KeepRulesSchema.safeParse(keepRules);
    if (!parsed.success) throw new WorkspaceError('INVALID_REQUEST');
    return this.setFeedSetting('keepRules', parsed.data);
  }
  private async setFeedSetting(
    key: 'criteria' | 'keepRules',
    value: CriteriaSettings | KeepRule[],
  ) {
    return this.store.write(async (tx) => {
      const meta = await tx.meta.get();
      const previous = meta.settings.criteria!;
      const settings = { ...meta.settings, [key]: value };
      const next = settings.criteria!;
      if (
        next.nextCustom < previous.nextCustom ||
        next.custom.some(
          (own) =>
            !previous.custom.some((old) => old.id === own.id) &&
            Number(own.id.slice(7)) < previous.nextCustom,
        )
      )
        throw new WorkspaceError('INVALID_REQUEST');
      if (key === 'criteria') {
        // Historical assessments still name removed IDs; keep their category room.
        settings.categories = [...meta.settings.categories];
        for (const own of next.custom)
          if (!settings.categories.includes(own.id))
            settings.categories.push(own.id);
        if (settings.categories.length > 32)
          throw new WorkspaceError('INVALID_REQUEST');
      }
      assertReviewSettings(settings);
      await tx.meta.set({
        ...meta,
        settings,
        updatedAt: this.now().toISOString(),
      });
      return {
        timeZone: settings.timeZone,
        categories: settings.categories,
        criteria: next,
        keepRules: settings.keepRules!,
        revision: (await tx.runtime.get()).revision,
      };
    });
  }
  private readonly store: WorkspaceStore;
  private readonly now: () => Date;

  constructor(store: WorkspaceStore, options: { now?: () => Date } = {}) {
    this.store = store;
    this.now = options.now ?? (() => new Date());
  }

  async setTimeZone(timeZone: string | null): Promise<SettingsChangeResult> {
    const setting = TimeZoneSettingSchema.safeParse(timeZone);
    if (!setting.success) throw new WorkspaceError('INVALID_REQUEST');
    const time = this.now().toISOString();
    try {
      return await this.store.write(async (tx) => {
        const meta = await tx.meta.get();
        const runtime = await tx.runtime.get();
        await tx.meta.set({
          ...meta,
          updatedAt: time,
          settings: { ...meta.settings, timeZone: setting.data },
        });
        const revision = runtime.revision + 1;
        await tx.runtime.set({ revision });
        return { timeZone: setting.data, revision };
      });
    } catch {
      throw new WorkspaceError('STORAGE');
    }
  }

  async setReviewView(
    view: ReviewView,
  ): Promise<{ review: ReviewView; revision: number }> {
    const setting = ReviewViewSchema.safeParse(view);
    if (!setting.success) throw new WorkspaceError('INVALID_REQUEST');
    try {
      return await this.store.write(async (tx) => {
        const meta = await tx.meta.get();
        const runtime = await tx.runtime.get();
        await tx.meta.set({
          ...meta,
          settings: { ...meta.settings, review: setting.data },
        });
        return { review: setting.data, revision: runtime.revision };
      });
    } catch {
      throw new WorkspaceError('STORAGE');
    }
  }
}
