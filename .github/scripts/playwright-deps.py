"""Bounded Linux CI package setup; never remove locks or stop foreign holders."""

import argparse
import ctypes
import errno
import json
import os
import signal
import subprocess
import time
from pathlib import Path

# Read by the workflow contract test; all runtime allowances use these values.
BOUNDS = {"installSeconds": [960, 600], "lockSeconds": 120, "probeSeconds": 5, "recoverySeconds": 60, "terminateSeconds": 1, "reapSeconds": 5, "pollSeconds": 0.05, "pauseSeconds": 0, "totalSeconds": 1740}

LOCKS = (
    '/var/lib/dpkg/lock-frontend',
    '/var/lib/dpkg/lock',
    '/var/lib/apt/lists/lock',
    '/var/cache/apt/archives/lock',
)


def emit(event, **fields):
    print(event + ' ' + json.dumps(fields, sort_keys=True), flush=True)


def lock_holders():
    # apt/dpkg use POSIX record locks. flock(1) would test a different lock.
    import fcntl

    busy = []
    for path in LOCKS:
        try:
            with open(path, 'a') as handle:
                try:
                    fcntl.lockf(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except OSError as error:
                    if error.errno not in (errno.EACCES, errno.EAGAIN):
                        raise
                    busy.append(path)
        except FileNotFoundError:
            continue
    if not busy:
        return []
    # Only closed process classes and ages leave this probe, never argv.
    result = subprocess.run(
        ['fuser', *busy], capture_output=True, text=True, timeout=BOUNDS['probeSeconds'], check=False
    )
    holders = []
    for pid in sorted(set(result.stdout.split())):
        if not pid.isdigit():
            continue
        try:
            name = Path('/proc', pid, 'comm').read_text().strip()
            fields = Path('/proc', pid, 'stat').read_text().rsplit(')', 1)[1].split()
            age = int(time.clock_gettime(time.CLOCK_BOOTTIME) - int(fields[19]) / os.sysconf('SC_CLK_TCK'))
        except (OSError, ValueError, IndexError):
            continue
        kind = name if name in ('apt', 'apt-get', 'dpkg') else (
            'unattended-upgrade' if name.startswith('unattended') else 'other'
        )
        holders.append({'class': kind, 'ageSeconds': max(0, age)})
    return holders or [{'class': 'unknown', 'ageSeconds': None}]


def wait_for_locks(deadline, probe=lock_holders, clock=time.monotonic, sleep=time.sleep):
    started = clock()
    seen = set()
    while True:
        holders = probe()
        seen.update(row['class'] for row in holders)
        waited = round(clock() - started, 3)
        if not holders:
            emit('APT_LOCK_READY', waitedSeconds=waited, holderClasses=sorted(seen) or ['none'])
            return
        emit('APT_LOCK_WAIT', waitedSeconds=waited, holders=holders)
        remaining = deadline - clock()
        if remaining <= 0:
            emit('APT_LOCK_TIMEOUT', waitedSeconds=waited, holderClasses=sorted(seen))
            raise RuntimeError('APT_LOCK_TIMEOUT')
        sleep(min(5, remaining))


def run_bounded(command, seconds):
    child = subprocess.Popen(command, start_new_session=True)
    try:
        return child.wait(timeout=seconds)
    except subprocess.TimeoutExpired:
        emit('APT_COMMAND_TIMEOUT', limitSeconds=seconds)
        return 124
    finally:
        # This script runs as root, unlike the former timeout -> pnpm -> sudo
        # chain. It can end its own root apt descendants before dpkg recovery.
        # Always sweep the owned group, including when its leader exited first.
        terminate_owned_group(child.pid)
        deadline = time.monotonic() + BOUNDS['reapSeconds']
        try:
            child.wait(timeout=BOUNDS['reapSeconds'])
        except subprocess.TimeoutExpired:
            raise RuntimeError('APT_CLEANUP_TIMEOUT')
        # Linux subreaper adoption lets us reap killed orphan grandchildren,
        # so recovery cannot race an owned apt process still holding a lock.
        while True:
            try:
                pid, _ = os.waitpid(-child.pid, os.WNOHANG)
                if pid == 0:
                    if time.monotonic() >= deadline:
                        raise RuntimeError('APT_CLEANUP_TIMEOUT')
                    time.sleep(BOUNDS['pollSeconds'])
            except ChildProcessError:
                break


def terminate_owned_group(group):
    for sig in (signal.SIGTERM, signal.SIGKILL):
        try:
            os.killpg(group, sig)
        except ProcessLookupError:
            return
        if sig == signal.SIGTERM:
            time.sleep(BOUNDS['terminateSeconds'])


def canonical_mirror(path=Path('/etc/apt/apt-mirrors.txt')):
    # On the disposable runner only, change the mirror-list file after a failed
    # install. apt still verifies the distribution's signed package indexes.
    if not path.exists():
        emit('APT_MIRROR_RETRY', state='not-applicable')
        return
    path.write_text('https://archive.ubuntu.com/ubuntu/\n')
    emit('APT_MIRROR_RETRY', state='canonical-https')


def install(command, run=run_bounded, wait=wait_for_locks, clock=time.monotonic, fallback=canonical_mirror):
    # Stay inside the existing 30-minute step, including lock waits and cleanup.
    deadline = clock() + BOUNDS['totalSeconds']
    cleanup = BOUNDS['terminateSeconds'] + BOUNDS['reapSeconds'] + 1
    for attempt, allowance in enumerate(BOUNDS['installSeconds'], 1):
        wait(min(deadline, clock() + BOUNDS['lockSeconds']))
        remaining = int(deadline - clock()) - cleanup
        if remaining <= 0:
            raise RuntimeError('APT_SETUP_TIMEOUT')
        emit('APT_INSTALL_ATTEMPT', attempt=attempt, limitSeconds=min(allowance, remaining))
        status = run(command, min(allowance, remaining))
        if status == 0:
            emit('APT_INSTALL_PASSED', attempt=attempt)
            return 0
        emit('APT_INSTALL_FAILED', attempt=attempt, exitCode=status)
        if attempt == len(BOUNDS['installSeconds']):
            raise RuntimeError('APT_INSTALL_FAILED')
        wait(min(deadline, clock() + BOUNDS['lockSeconds']))
        remaining = int(deadline - clock()) - cleanup
        if remaining <= 0:
            raise RuntimeError('APT_SETUP_TIMEOUT')
        if run(['dpkg', '--configure', '-a'], min(BOUNDS['recoverySeconds'], remaining)) != 0:
            raise RuntimeError('APT_RECOVERY_FAILED')
        fallback()
    raise RuntimeError('APT_INSTALL_FAILED')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--node', required=True)
    parser.add_argument('--cli', required=True)
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise RuntimeError('APT_ROOT_REQUIRED')
    enable_subreaper()
    return install([args.node, args.cli, 'install-deps', 'chromium', 'firefox', 'webkit'])


def enable_subreaper():
    if ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0) != 0:
        raise RuntimeError('APT_SUBREAPER_FAILED')


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (RuntimeError, OSError, subprocess.SubprocessError) as error:
        code = str(error) if isinstance(error, RuntimeError) else 'APT_SETUP_PROBE_FAILED'
        emit('APT_SETUP_FAILED', code=code)
        raise SystemExit(1)
