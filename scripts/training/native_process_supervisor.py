"""Linux owner-pipe supervisor for native research processes. Stdlib; no provider calls.

The detached guardian survives a kill of its owner's process group. EOF on the
owner-only stdin pipe starts cleanup. A subreaper adopts orphaned grandchildren,
including those which create new sessions; pidfds avoid signalling reused PIDs.
"""
from __future__ import annotations
import argparse
import ctypes
import json
import os
from pathlib import Path
import select
import signal
import subprocess
import sys
import time


def pidfd_open(pid):
    if hasattr(os, 'pidfd_open'):
        return os.pidfd_open(pid)
    # python-build-standalone may be built against headers predating pidfds;
    # use the host libc's typed wrapper, never architecture-specific syscall IDs.
    libc = ctypes.CDLL(None, use_errno=True)
    call = libc.pidfd_open
    call.argtypes, call.restype = [ctypes.c_int, ctypes.c_uint], ctypes.c_int
    fd = call(pid, 0)
    if fd < 0:
        raise OSError(ctypes.get_errno(), 'pidfd_open_failed')
    return fd


def pidfd_send_signal(fd, signum):
    if hasattr(signal, 'pidfd_send_signal'):
        return signal.pidfd_send_signal(fd, signum)
    libc = ctypes.CDLL(None, use_errno=True)
    call = libc.pidfd_send_signal
    call.argtypes, call.restype = [ctypes.c_int, ctypes.c_int, ctypes.c_void_p, ctypes.c_uint], ctypes.c_int
    if call(fd, signum, None, 0) != 0:
        raise OSError(ctypes.get_errno(), 'pidfd_send_signal_failed')


def check_support():
    if sys.platform != 'linux':
        raise RuntimeError('native_supervision_requires_linux_pidfds')
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(36, 1, 0, 0, 0) != 0:  # PR_SET_CHILD_SUBREAPER
        raise OSError(ctypes.get_errno(), 'subreaper_required')
    fd = pidfd_open(os.getpid())
    try:
        pidfd_send_signal(fd, 0)
    finally:
        os.close(fd)
    Path(f'/proc/{os.getpid()}/task/{os.getpid()}/children').read_text()


def publish(path, value):
    path = Path(path)
    temp = path.with_name(path.name + '.tmp')
    with open(temp, 'w', opener=lambda p, flags: os.open(p, flags, 0o600)) as stream:
        json.dump(value, stream)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temp, path)
    fd = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def identity(pid):
    try:
        fields = Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()
        return fields[0], int(fields[1]), fields[19]  # state, parent, start ticks
    except (OSError, ValueError, IndexError):
        return None


def descendants():
    pending, found = [os.getpid()], {}
    while pending:
        parent = pending.pop()
        for task in Path(f'/proc/{parent}/task').glob('*/children'):
            try:
                children = [int(p) for p in task.read_text().split()]
            except OSError:
                continue
            for pid in children:
                if pid in found:
                    continue
                observed = identity(pid)
                if observed:
                    found[pid] = observed
                    pending.append(pid)
    return found


def signal_owned(signum):
    for pid, observed in reversed(list(descendants().items())):
        try:
            fd = pidfd_open(pid)
            try:
                # PID lifetime is now pinned. Recheck the observation made before open.
                if (current := identity(pid)) and current[1:] == observed[1:]:
                    pidfd_send_signal(fd, signum)
            finally:
                os.close(fd)
        except ProcessLookupError:
            pass


def reap():
    statuses = {}
    while True:
        try:
            pid, status = os.waitpid(-1, os.WNOHANG)
        except ChildProcessError:
            return statuses, True
        if not pid:
            return statuses, False
        statuses[pid] = os.waitstatus_to_exitcode(status)


def supervise(command, record, role, *, abort_file=None, comparison=None, grace=1.0):
    check_support()
    owner = os.getppid()
    requested = []
    for signum in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(signum, lambda sig, _frame: requested.append(sig))
    # Owner death before launch must not create a new child.
    if select.select([0], [], [], 0)[0] and not os.read(0, 1):
        raise RuntimeError('supervisor_owner_gone_before_launch')
    root = subprocess.Popen(command, stdin=subprocess.DEVNULL, close_fds=True, start_new_session=True)
    try:
        report = {'kind': 'native-process-supervision/v1', 'role': role, 'guardian_pid': os.getpid(), 'owner_pid': owner,
                  'root_pid': root.pid, 'cleanup_verified': False, 'remaining_pids': None, 'reason': None,
                  'provider_cancellation': 'not_attested'}
        publish(record, report)
        reason = None
        exit_code = None
        started_cleanup = None
        abort_written = False
        while True:
            statuses, empty = reap()
            if root.pid in statuses:
                exit_code = statuses[root.pid]
                root.returncode = exit_code  # avoid Popen trying to reap it again
                if reason is None:
                    reason = 'root_exited' if exit_code == 0 else 'root_failed_or_killed'
            if reason is None:
                if requested:
                    reason = 'supervisor_signal'
                elif select.select([0], [], [], 0.05)[0] and not os.read(0, 4096):
                    reason = 'owner_pipe_closed'
            if reason is None:
                continue
            if started_cleanup is None:
                started_cleanup = time.monotonic()
                report.update(reason=reason, exit_code=exit_code)
                publish(record, report)
            if abort_file and not abort_written and reason != 'root_exited':
                path = Path(abort_file)
                path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                try:
                    with open(path, 'x', opener=lambda p, flags: os.open(p, flags, 0o600)) as stream:
                        json.dump({'comparison_sha256': comparison, 'status': 'aborted_no_automatic_resumption',
                                   'reason': 'supervisor_' + reason}, stream)
                        stream.flush()
                        os.fsync(stream.fileno())
                    fd = os.open(path.parent, os.O_RDONLY)
                    try:
                        os.fsync(fd)
                    finally:
                        os.close(fd)
                except FileExistsError:
                    pass
                abort_written = True
            remaining = descendants()
            if empty and not remaining:
                report.update(cleanup_verified=True, remaining_pids=[], exit_code=exit_code)
                publish(record, report)
                return exit_code if reason == 'root_exited' else 125
            # Keep the guardian alive until *all* descendants are reaped. If a kernel
            # task cannot die promptly, callers time out and cannot claim cleanup.
            signal_owned(signal.SIGTERM if time.monotonic()-started_cleanup < grace else signal.SIGKILL)
            time.sleep(0.025)
    finally:
        # Even a journal/metadata exception must not abandon a live child tree.
        started = time.monotonic()
        while True:
            _, empty = reap()
            if empty and not descendants():
                break
            signal_owned(signal.SIGTERM if time.monotonic()-started < grace else signal.SIGKILL)
            time.sleep(0.025)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--record', type=Path, required=True)
    parser.add_argument('--role', required=True)
    parser.add_argument('--abort-file', type=Path)
    parser.add_argument('--comparison')
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    if not command or args.record.exists():
        raise RuntimeError('supervisor_fresh_record_and_command_required')
    return supervise(command, args.record, args.role, abort_file=args.abort_file, comparison=args.comparison)


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as error:
        print('native_supervisor_failed:' + type(error).__name__, file=sys.stderr)
        raise SystemExit(126)
