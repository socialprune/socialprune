import { z } from 'zod';
import { resolveTimeZone } from './time.ts';
import { ReviewViewSchema } from '../model/index.ts';

/** Old or malformed stored views do not prevent a review from opening. */
export function storedReviewView(value: unknown) {
  const result = ReviewViewSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

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
