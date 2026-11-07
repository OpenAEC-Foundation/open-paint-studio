#!/usr/bin/env python3
"""THROWAWAY SPIKE: runs a program that prints "NAME <CLOCK_MONOTONIC us>"
lines, converts each stamp to milliseconds since the program was spawned,
and samples the process's PSS (smaps_rollup) once PSS_AFTER appears and
again 0.5 s later. Prints the median and best of N runs per stamp.

    python3 spikes/gpu/measure.py [-n RUNS] [--pss-after NAME] -- COMMAND...
"""
import os, statistics, subprocess, sys, threading, time

def pss_kb(pid):
    try:
        for line in open(f"/proc/{pid}/smaps_rollup"):
            if line.startswith("Pss:"):
                return int(line.split()[1])
    except OSError:
        return None

def one(command, pss_after):
    start = time.monotonic()
    proc = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, bufsize=1)
    stamps, extra, memory = {}, [], {}
    for line in proc.stdout:
        parts = line.split()
        if len(parts) == 2 and parts[1].lstrip("-").isdigit() and (parts[0].startswith("pss-") or parts[0].startswith("main-")):
            memory[parts[0]] = int(parts[1])
        elif len(parts) == 2 and parts[1].isdigit():
            stamps[parts[0]] = int(parts[1]) / 1e6 - start
            if parts[0] == pss_after:
                memory["at"] = pss_kb(proc.pid)
                threading.Timer(0.5, lambda: memory.__setitem__("later", pss_kb(proc.pid))).start()
        else:
            extra.append(line.strip())
    proc.wait()
    return stamps, memory, extra

args = sys.argv[1:]
runs, pss_after = 5, "presented"
while args and args[0] != "--":
    if args[0] == "-n":
        runs = int(args[1]); args = args[2:]
    elif args[0] == "--pss-after":
        pss_after = args[1]; args = args[2:]
    else:
        break
command = args[1:] if args and args[0] == "--" else args
results = [one(command, pss_after) for _ in range(runs)]
names = list(results[0][0])
for name in names:
    values = [r[0][name] * 1000 for r in results if name in r[0]]
    print(f"{name:>14}: median {statistics.median(values):7.1f} ms   best {min(values):7.1f} ms")
for key in ("at", "later", "pss-cpu", "pss-gpu"):
    values = [r[1].get(key) for r in results if r[1].get(key)]
    if values:
        print(f"{'PSS ' + key:>14}: median {statistics.median(values) / 1024:7.1f} MB")
values = [r[1].get("main-longest-gap-us") for r in results if r[1].get("main-longest-gap-us") is not None]
if values:
    print(f"{'main stall':>14}: max {max(values) / 1000:7.1f} ms")
if results[0][2]:
    print("output:", " | ".join(results[0][2][:3]))
