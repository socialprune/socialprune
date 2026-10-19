import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { directory } from '../packaging/paths.ts';
import { runPowerShell } from '../packaging/windows-powershell.ts';
import { testEnvironment } from './process-environment.ts';
import {
  compareSystemSnapshots,
  type SystemSnapshot,
} from '../packaging/system-check.ts';

test.skipIf(process.platform !== 'win32')(
  'bulk firewall rows retain every legacy field digest, multiplicity, attribution and writable branch',
  async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'socialprune-firewall-rows-'));
    try {
      const { stdout } = await runPowerShell(
        [
          '-NoProfile',
          '-NonInteractive',
          '-File',
          join(directory, 'e2e/firewall-inventory-controls.ps1'),
          '-Scratch',
          scratch,
        ],
        { timeout: 45000, windowsHide: true, env: testEnvironment() },
      );
      const result = JSON.parse(stdout) as {
        controlRow: SystemSnapshot['firewall'][number];
        changedRow: SystemSnapshot['firewall'][number];
      };
      expect(result).toMatchObject({
        generatedRows: 19,
        normalizedRows: 5,
        fieldsPerRule: 23,
        digestsEqual: true,
        strictnessEqual: true,
        attributionEqual: true,
        machineWritableBranches: 2,
        plantedUserRuleCaught: true,
        plantedMutationCaught: true,
        unknownFieldsRefused: true,
        unknownTypesRefused: true,
      });
      const empty: SystemSnapshot = {
        version: 2,
        services: [],
        tasks: [],
        runKeys: [],
        firewall: [],
        startup: [],
        listeners: [],
      };
      const planted = { ...empty, firewall: [result.controlRow] };
      expect(compareSystemSnapshots(empty, planted).failures).toEqual([
        {
          inventory: 'firewall',
          name: 'SocialPrune-test-generated',
          fields: [],
          reason: 'added',
        },
      ]);
      expect(
        compareSystemSnapshots(planted, {
          ...empty,
          firewall: [result.changedRow],
        }).failures,
      ).toEqual([
        {
          inventory: 'firewall',
          name: 'SocialPrune-test-generated',
          fields: ['ApplicationName'],
          reason: 'user-writable',
        },
      ]);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  },
  60000,
);
