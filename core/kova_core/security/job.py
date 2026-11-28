import ctypes
import os
import signal
import subprocess
import time
from typing import Any


if os.name == "nt":
    from ctypes import wintypes

    class _BasicLimit(ctypes.Structure):
        _fields_ = [
            ("PerProcessUserTimeLimit", ctypes.c_int64),
            ("PerJobUserTimeLimit", ctypes.c_int64),
            ("LimitFlags", wintypes.DWORD),
            ("MinimumWorkingSetSize", ctypes.c_size_t),
            ("MaximumWorkingSetSize", ctypes.c_size_t),
            ("ActiveProcessLimit", wintypes.DWORD),
            ("Affinity", ctypes.c_size_t),
            ("PriorityClass", wintypes.DWORD),
            ("SchedulingClass", wintypes.DWORD),
        ]

    class _IoCounters(ctypes.Structure):
        _fields_ = [
            ("ReadOperationCount", ctypes.c_uint64),
            ("WriteOperationCount", ctypes.c_uint64),
            ("OtherOperationCount", ctypes.c_uint64),
            ("ReadTransferCount", ctypes.c_uint64),
            ("WriteTransferCount", ctypes.c_uint64),
            ("OtherTransferCount", ctypes.c_uint64),
        ]

    class _ExtendedLimit(ctypes.Structure):
        _fields_ = [
            ("BasicLimitInformation", _BasicLimit),
            ("IoInfo", _IoCounters),
            ("ProcessMemoryLimit", ctypes.c_size_t),
            ("JobMemoryLimit", ctypes.c_size_t),
            ("PeakProcessMemoryUsed", ctypes.c_size_t),
            ("PeakJobMemoryUsed", ctypes.c_size_t),
        ]

    _KERNEL32 = ctypes.windll.kernel32
    _KERNEL32.CreateJobObjectW.restype = wintypes.HANDLE
    _KERNEL32.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
    _KERNEL32.SetInformationJobObject.argtypes = [
        wintypes.HANDLE,
        ctypes.c_int,
        ctypes.c_void_p,
        wintypes.DWORD,
    ]
    _KERNEL32.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    _KERNEL32.OpenProcess.restype = wintypes.HANDLE
    _KERNEL32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    _KERNEL32.CloseHandle.argtypes = [wintypes.HANDLE]
    _KERNEL32.TerminateJobObject.argtypes = [wintypes.HANDLE, wintypes.UINT]

    _JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000
    _JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION = 0x00000400
    _JOB_OBJECT_LIMIT_ACTIVE_PROCESS = 0x00000008
    _JOB_OBJECT_EXTENDED_LIMIT_INFORMATION = 9
    _PROCESS_SET_QUOTA = 0x0100
    _PROCESS_TERMINATE = 0x0001


def _is_windows() -> bool:
    return os.name == "nt"


def spawn_kwargs() -> dict[str, Any]:
    """Platform-safe Popen kwargs for agent processes.

    POSIX starts a new session so the whole process group can be terminated.
    Windows keeps the hidden-console flag; Job Object assignment happens after
    the process starts.
    """
    if _is_windows():
        return {"creationflags": getattr(subprocess, "CREATE_NO_WINDOW", 0)}
    return {"start_new_session": True}


def kill_process_group(process: subprocess.Popen[Any]) -> None:
    if process.poll() is not None:
        return
    if _is_windows():
        subprocess.run(
            ["taskkill", "/PID", str(process.pid), "/T", "/F"],
            capture_output=True,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        return
    try:
        group = os.getpgid(process.pid)
    except (ProcessLookupError, PermissionError, OSError):
        group = None
    if group is None:
        try:
            process.terminate()
        except OSError:
            return
        return
    try:
        os.killpg(group, signal.SIGTERM)
    except (ProcessLookupError, PermissionError, OSError):
        try:
            process.terminate()
        except OSError:
            return
    deadline = time.monotonic() + 0.6
    while time.monotonic() < deadline:
        if not _pgid_alive(group):
            return
        time.sleep(0.05)
    try:
        os.killpg(group, getattr(signal, "SIGKILL", signal.SIGTERM))
    except (ProcessLookupError, PermissionError, OSError):
        try:
            process.kill()
        except OSError:
            pass


def _pgid_alive(pid: int) -> bool:
    try:
        os.killpg(pid, 0)
        return True
    except (ProcessLookupError, PermissionError, OSError):
        return False


class ProcessJail:
    """Best-effort process containment, not a filesystem/network boundary.

    Windows uses a Job Object with kill-on-close. POSIX uses a new session and
    kills the process group. Agent commands are spawned with ``spawn_kwargs``.
    """

    def __init__(self) -> None:
        self._handle: Any = None
        self._pids: set[int] = set()
        self.available = False
        if not _is_windows():
            self.available = hasattr(os, "killpg")
            return
        try:
            handle = _KERNEL32.CreateJobObjectW(None, None)
            if not handle:
                return
            info = _ExtendedLimit()
            info.BasicLimitInformation.LimitFlags = (
                _JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
                | _JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION
                | _JOB_OBJECT_LIMIT_ACTIVE_PROCESS
            )
            info.BasicLimitInformation.ActiveProcessLimit = 128
            configured = _KERNEL32.SetInformationJobObject(
                handle,
                _JOB_OBJECT_EXTENDED_LIMIT_INFORMATION,
                ctypes.byref(info),
                ctypes.sizeof(info),
            )
            if not configured:
                _KERNEL32.CloseHandle(handle)
                return
            self._handle = handle
            self.available = True
        except (AttributeError, OSError):
            self._handle = None

    def assign(self, pid: int) -> bool:
        if not _is_windows():
            if not self.available:
                return False
            self._pids.add(int(pid))
            return True
        if not self.available or not self._handle:
            return False
        process = _KERNEL32.OpenProcess(
            _PROCESS_SET_QUOTA | _PROCESS_TERMINATE,
            False,
            int(pid),
        )
        if not process:
            return False
        try:
            return bool(_KERNEL32.AssignProcessToJobObject(self._handle, process))
        finally:
            _KERNEL32.CloseHandle(process)

    def terminate(self) -> None:
        if not _is_windows():
            pids = list(self._pids)
            for pid in pids:
                try:
                    os.killpg(pid, signal.SIGTERM)
                except (ProcessLookupError, PermissionError, OSError):
                    pass
            deadline = time.monotonic() + 0.6
            while time.monotonic() < deadline and pids:
                pids = [
                    pid
                    for pid in pids
                    if _pgid_alive(pid)
                ]
                if pids:
                    time.sleep(0.05)
            for pid in pids:
                try:
                    os.killpg(pid, getattr(signal, "SIGKILL", signal.SIGTERM))
                except (ProcessLookupError, PermissionError, OSError):
                    pass
            self._pids.clear()
            return
        if self.available and self._handle:
            try:
                _KERNEL32.TerminateJobObject(self._handle, 1)
            except OSError:
                pass

    def close(self) -> None:
        if not _is_windows():
            self.terminate()
            self.available = False
            return
        if self._handle:
            try:
                _KERNEL32.CloseHandle(self._handle)
            except OSError:
                pass
            self._handle = None
        self.available = False
