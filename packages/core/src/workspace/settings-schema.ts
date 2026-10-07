import { z } from 'zod';
import { resolveTimeZone } from './time.ts';

/** Use the same Intl zone validation as the grouping resolver; no normalization. */
export const TimeZoneSettingSchema = z
  .string()
  .min(1)
  .max(128)
  .refine((zone) => {
    try {
      resolveTimeZone(zone, null, 'UTC');
      return true;
    } catch {
      return false;
    }
  })
  .nullable();
