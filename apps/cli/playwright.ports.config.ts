function port(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > 65535)
    throw new Error('Invalid generated browser test port.');
  return value;
}
export const TEST_PORTS = Object.freeze({
  x: port('SP_X_TEST_PORT', 4231),
  confirmation: port('SP_CONFIRMATION_TEST_PORT', 4232),
  reviewMedia: port('SP_REVIEW_MEDIA_TEST_PORT', 4234),
  style: port('SP_STYLE_TEST_PORT', 4238),
  foreign: port('SP_FOREIGN_TEST_PORT', 4239),
  engineInstagram: port('SP_ENGINE_INSTAGRAM_TEST_PORT', 4541),
});
export const TEST_ORIGINS: Readonly<
  Record<'x' | 'confirmation' | 'style' | 'foreign', string>
> = Object.freeze({
  x: `http://127.0.0.1:${TEST_PORTS.x}`,
  confirmation: `http://127.0.0.1:${TEST_PORTS.confirmation}`,
  style: `http://127.0.0.1:${TEST_PORTS.style}`,
  foreign: `http://127.0.0.1:${TEST_PORTS.foreign}`,
});
