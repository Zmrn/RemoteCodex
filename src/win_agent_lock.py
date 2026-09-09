"""Hold a device-registry lock until the owning Node process closes stdin."""
import sys
import time
import msvcrt

with open(sys.argv[1], "a+b", buffering=0) as lock:
    deadline = time.monotonic() + 12
    while True:
        try:
            lock.seek(0)
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
            break
        except OSError:
            if time.monotonic() >= deadline:
                sys.exit(1)
            time.sleep(0.025)
    try:
        print("LOCKED", flush=True)
        sys.stdin.buffer.read()
    finally:
        lock.seek(0)
        msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
