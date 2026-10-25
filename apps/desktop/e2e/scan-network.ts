import type { NetworkObservation } from '../packaging/network-check.ts';

export function assertScanNetwork(input: {
  observation: NetworkObservation;
  enginePid: number;
  peers: ReadonlySet<number>;
  harnessSockets: ReadonlySet<string>;
  requireEngineConnection: boolean;
}) {
  const { observation, enginePid, peers, harnessSockets } = input;
  if (!observation.ticks) throw new Error('SCAN_NETWORK_OBSERVATION_MISSING');
  let engineConnection = false;
  for (const line of observation.violations) {
    const [kind, pid, family, port] = line.split('|');
    if (harnessSockets.has(line.split('|').slice(0, 4).join('|'))) continue;
    if (
      kind !== 'connection' ||
      pid !== String(enginePid) ||
      family !== '2' ||
      !peers.has(Number(port))
    )
      throw new Error('SCAN_NETWORK_OUTSIDE_SCOPE');
    engineConnection = true;
  }
  if (input.requireEngineConnection && !engineConnection)
    throw new Error('SCAN_ENGINE_CONNECTION_NOT_OBSERVED');
}
