import {
  FuseState,
  FuseV1Options,
  FuseVersion,
  getCurrentFuseWire,
} from '@electron/fuses';

export function fuseConfiguration(test: boolean) {
  return {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: test,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
  };
}

export async function assertFuses(path: string, test: boolean) {
  const wire = await getCurrentFuseWire(path);
  if (wire.version !== FuseVersion.V1) throw new Error('FUSE_VERSION_MISMATCH');
  for (const [key, enabled] of Object.entries(fuseConfiguration(test))) {
    if (key === 'version') continue;
    const option: FuseV1Options = Number(key);
    if (wire[option] !== (enabled ? FuseState.ENABLE : FuseState.DISABLE))
      throw new Error(`FUSE_MISMATCH_${key}`);
  }
  return wire;
}
