// Generated subprocess fixtures inherit only OS/executable-discovery settings,
// never a parent PowerShell's policy, module/cache or lockdown overrides. The
// production launcher deliberately preserves policy/lockdown; this fixture
// builder is reachable only from test entrypoints.
const allowed = new Set([
  'SYSTEMROOT',
  'WINDIR',
  'PATH',
  'PATHEXT',
  'COMSPEC',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'LOCALAPPDATA',
  'APPDATA',
  'TEMP',
  'TMP',
  'PROGRAMDATA',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'COMMONPROGRAMFILES',
  'COMMONPROGRAMFILES(X86)',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
  'PROCESSOR_IDENTIFIER',
]);

export function testEnvironment(
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  const values = new Map<string, [string, string | undefined]>();
  // eslint-disable-next-line no-restricted-properties -- Read only the explicit OS/executable allowlist for generated child fixtures, never keys or unrelated values.
  for (const [name, value] of Object.entries(process.env))
    if (allowed.has(name.toUpperCase()))
      values.set(name.toUpperCase(), [name, value]);
  for (const [name, value] of Object.entries(overrides))
    values.set(name.toUpperCase(), [name, value]);
  return Object.fromEntries([...values.values()]);
}
