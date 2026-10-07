import { WorkspaceError } from './errors.ts';
import { TimeZoneSettingSchema } from './settings-schema.ts';
import type { WorkspaceStore } from './store.ts';

export interface SettingsChangeResult {
  timeZone: string | null;
  revision: number;
}

/** Neutral metadata writes only. A setting never appends a human or label event. */
export class SettingsService {
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
}
