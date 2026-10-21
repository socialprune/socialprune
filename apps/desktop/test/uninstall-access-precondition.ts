export type UninstallAccessPrecondition = {
  pid?: number;
  parentElevated: boolean;
  debugPrivilegePresent: boolean;
  debugPrivilegeEnabled: boolean;
  openSucceeded: boolean;
  openError: number;
  born?: string | null;
};

export function uninstallAccessDisposition(value: UninstallAccessPrecondition) {
  if (!value.openSucceeded && value.openError === 5) return 'assert-denied';
  if (
    value.openSucceeded &&
    value.openError === 0 &&
    (value.parentElevated || value.debugPrivilegeEnabled)
  )
    return 'record-only';
  throw new Error('UNINSTALL_DENIAL_PRECONDITION_NOT_MET');
}
