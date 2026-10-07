import { z } from 'zod';

// ADR-004: each browser entry imports this first, before any schema module.
// The web owner wires that ordering in the page and every worker entry.
z.config({ jitless: true });
