"""Shared, pessimistic request reservations for the local Tinker pilot.

Reservations survive errors and restarts. They are estimates, not invoice data.
An exclusive file lock also serializes requests from trainer and local server.
"""
from contextlib import contextmanager
import fcntl
import json
import math
import os
from pathlib import Path


class PilotBudget:
    # Verified 2026-09-06 against Tinker's models page. Uncached rates, USD / M.
    MODEL = "thinkingmachines/Inkling-Small"
    # Use undiscounted rates, even while the provider's 50% discount applies.
    PREFILL = 1.16
    SAMPLE = 2.88
    TRAIN = 3.46
    SAFETY_FACTOR = 5

    def __init__(self, path, cap_usd=100.0):
        self.path = Path(path)
        if not math.isfinite(cap_usd) or not 0 < cap_usd <= 100:
            raise ValueError("Pilot cap must be positive and at most the authorized USD 100")
        self.cap = cap_usd

    @contextmanager
    def reserve(self, label, *, prefill=0, sample=0, train=0, fixed_usd=0):
        counts = [prefill, sample, train]
        if any(type(n) is not int or n < 0 for n in counts):
            raise ValueError("Token reservations must be nonnegative integers")
        if not math.isfinite(fixed_usd) or fixed_usd < 0:
            raise ValueError("Invalid fixed reservation")
        cost = fixed_usd + self.SAFETY_FACTOR * (
            prefill * self.PREFILL + sample * self.SAMPLE + train * self.TRAIN
        ) / 1_000_000
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        lock_fd = os.open(str(self.path) + ".lock", os.O_CREAT | os.O_RDWR, 0o600)
        with os.fdopen(lock_fd, "w") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            data = json.loads(self.path.read_text()) if self.path.exists() else {
                "cap_usd": self.cap, "reserved_usd": 0.0, "events": [],
                "accounting": "pessimistic estimates; not provider billed cost",
                "rates_verified_on": "2026-09-06", "model": self.MODEL,
            }
            if data["cap_usd"] != self.cap or data["model"] != self.MODEL:
                raise ValueError("Existing budget cap/model cannot change")
            if data["reserved_usd"] + cost > self.cap:
                raise ValueError("Pilot budget exhausted; no request dispatched")
            data["reserved_usd"] += cost
            data["events"].append({"operation": label, "reserved_usd": cost,
                                   "prefill_tokens": prefill, "sample_tokens": sample,
                                   "train_tokens": train})
            temp = self.path.with_suffix(".next")
            fd = os.open(temp, os.O_CREAT | os.O_WRONLY | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w") as output:
                json.dump(data, output, indent=2)
                output.flush()
                os.fsync(output.fileno())
            os.replace(temp, self.path)
            yield cost
