function port(name: string, fallback: number): number {
  // eslint-disable-next-line no-restricted-properties -- Node test-runner ports only, never credentials.
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > 65535)
    throw new Error('Invalid generated browser test port.');
  return value;
}
export const CONTEXT_PORTS = Object.freeze({
  instagram: port('SP_CONTEXT_TEST_PORT', 4401),
  confirmation: port('SP_CONTEXT_CONFIRMATION_TEST_PORT', 4402),
  server: port('SP_CONTEXT_SERVER_TEST_PORT', 4403),
  review: port('SP_CONTEXT_REVIEW_TEST_PORT', 4404),
  foreign: port('SP_CONTEXT_FOREIGN_TEST_PORT', 4419),
});
export const CONTEXT_ORIGINS = Object.freeze({
  instagram: `http://127.0.0.1:${CONTEXT_PORTS.instagram}`,
  confirmation: `http://127.0.0.1:${CONTEXT_PORTS.confirmation}`,
  server: `http://127.0.0.1:${CONTEXT_PORTS.server}`,
  review: `http://127.0.0.1:${CONTEXT_PORTS.review}`,
  foreign: `http://127.0.0.1:${CONTEXT_PORTS.foreign}`,
});
