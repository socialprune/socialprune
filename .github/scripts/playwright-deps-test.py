"""No package changes: deterministic policy probes and a disposable lock."""

import contextlib
import importlib.util
import io
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

spec = importlib.util.spec_from_file_location('deps', Path(__file__).with_name('playwright-deps.py'))
deps = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deps)


class Policy(unittest.TestCase):
    def test_wait_then_release_reports_holder_and_duration(self):
        now = [0]
        probes = iter([[{'class': 'apt-get', 'ageSeconds': 960}], []])
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            deps.wait_for_locks(10, lambda: next(probes), lambda: now[0], lambda n: now.__setitem__(0, now[0] + n))
        self.assertIn('"waitedSeconds": 5', output.getvalue())
        self.assertIn('"holderClasses": ["apt-get"]', output.getvalue())

    def test_lock_timeout_never_starts_install(self):
        now = [0]
        calls = []
        def wait(_):
            deps.wait_for_locks(3, lambda: [{'class': 'dpkg', 'ageSeconds': 1}], lambda: now[0], lambda n: now.__setitem__(0, now[0] + n))
        with self.assertRaisesRegex(RuntimeError, '^APT_LOCK_TIMEOUT$'):
            deps.install(['generated'], lambda *args: calls.append(args), wait, lambda: now[0], lambda: self.fail('mirror change before lock release'))
        self.assertEqual(calls, [])

    def test_timeout_is_cleaned_before_recovery_and_only_one_retry(self):
        events = []
        returns = iter([124, 0, 0])
        def run(command, seconds):
            events.append((command, seconds))
            return next(returns)
        self.assertEqual(deps.install(['generated'], run, lambda _: events.append('wait'), lambda: 0, lambda: events.append('mirror')), 0)
        self.assertEqual(events, ['wait', (['generated'], 960), 'wait', (['dpkg', '--configure', '-a'], 60), 'mirror', 'wait', (['generated'], 600)])
        with self.assertRaisesRegex(RuntimeError, '^APT_INSTALL_FAILED$'):
            deps.install(['generated'], lambda command, _: 0 if command[0] == 'dpkg' else 1, lambda _: None, lambda: 0, lambda: None)

    def test_recovery_failure_and_total_deadline_fail_closed(self):
        with self.assertRaisesRegex(RuntimeError, '^APT_RECOVERY_FAILED$'):
            deps.install(['generated'], lambda *_: 1, lambda _: None, lambda: 0, lambda: self.fail('mirror before recovery'))
        now = [0]
        def wait(_):
            now[0] = 1740
        with self.assertRaisesRegex(RuntimeError, '^APT_SETUP_TIMEOUT$'):
            deps.install(['generated'], lambda *_: self.fail('command after deadline'), wait, lambda: now[0], lambda: None)

    def test_retry_mirror_changes_only_explicit_disposable_file(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder, 'mirrors.txt')
            deps.canonical_mirror(path)
            self.assertFalse(path.exists())
            path.write_text('http://azure.archive.ubuntu.com/ubuntu/\n')
            deps.canonical_mirror(path)
            self.assertEqual(path.read_text(), 'https://archive.ubuntu.com/ubuntu/\n')

    def test_owned_group_cleanup_escalates_term_to_kill(self):
        import signal
        with patch.object(signal, 'SIGKILL', 9, create=True), patch.object(deps.os, 'killpg', create=True) as kill, patch.object(deps.time, 'sleep') as sleep:
            deps.terminate_owned_group(123)
        self.assertEqual(kill.call_args_list[0].args, (123, signal.SIGTERM))
        self.assertEqual(kill.call_args_list[1].args, (123, signal.SIGKILL if hasattr(signal, 'SIGKILL') else 9))
        sleep.assert_called_once_with(1)

    @unittest.skipUnless(sys.platform == 'linux', 'real POSIX locks/process groups require Linux')
    def test_real_record_lock_and_owned_descendant_cleanup(self):
        deps.enable_subreaper()
        with tempfile.TemporaryDirectory() as folder:
            lock = str(Path(folder, 'lock'))
            Path(lock).touch()
            old = deps.LOCKS
            holder = subprocess.Popen([sys.executable, '-c', 'import fcntl,sys,time; f=open(sys.argv[1],"a"); fcntl.lockf(f,fcntl.LOCK_EX); print("ready",flush=True); time.sleep(30)', lock], stdout=subprocess.PIPE, text=True)
            try:
                self.assertEqual(holder.stdout.readline().strip(), 'ready')
                deps.LOCKS = (lock,)
                self.assertTrue(deps.lock_holders())
                holder.terminate()
                holder.wait(timeout=5)
                self.assertEqual(deps.lock_holders(), [])
                # A TERM-ignoring child holds a lock past its parent's timeout.
                descendant = 'import fcntl,pathlib,signal,sys,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); f=open(sys.argv[1],"a"); fcntl.lockf(f,fcntl.LOCK_EX); pathlib.Path(sys.argv[1]+".ready").touch(); time.sleep(30)'
                parent = 'import pathlib,subprocess,sys,time; subprocess.Popen([sys.executable,"-c",sys.argv[1],sys.argv[2]]); deadline=time.monotonic()+5; ready=pathlib.Path(sys.argv[2]+".ready");\nwhile not ready.exists() and time.monotonic()<deadline: time.sleep(.01)\nassert ready.exists(); time.sleep(30)'
                self.assertEqual(deps.run_bounded([sys.executable, '-c', parent, descendant, lock], 1), 124)
                self.assertTrue(Path(lock + '.ready').exists())
                self.assertEqual(deps.lock_holders(), [])
            finally:
                deps.LOCKS = old
                if holder.poll() is None:
                    holder.kill()
                    holder.wait()
                holder.stdout.close()


if __name__ == '__main__':
    unittest.main()
