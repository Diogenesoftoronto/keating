#!/usr/bin/env python3
"""Reproduce the narrowly scoped Scheme defects discussed in the case study."""
import json
import subprocess

original = '''(define (sum-all . args)
  (cond ((null? args) 0)
        ((number? (car args)) (+ (car args) (sum-all (cdr args))))
        (else (sum-all (cdr args)))))
(write (sum-all 1 "hello" 3))'''
corrected = '''(define (sum-all . args)
  (let loop ((xs args))
    (cond ((null? xs) 0)
          ((number? (car xs)) (+ (car xs) (loop (cdr xs))))
          (else (loop (cdr xs))))))
(write (list (sum-all) (sum-all 1 "hello" 3) (sum-all 1 2 3)))'''


def run(program, timeout=2):
    return subprocess.run(["guile", "--no-auto-compile", "-c", program],
                          text=True, capture_output=True, timeout=timeout, check=True).stdout


if __name__ == "__main__":
    timed_out = False
    try:
        run(original)
    except subprocess.TimeoutExpired:
        timed_out = True
    assert timed_out, "The exported reference implementation no longer reproduces the timeout"
    result = run(corrected)
    assert result == "(0 4 6)"
    rest = run("(define (capture . args) args) (write (capture (list)))")
    assert rest == "(())"
    datum = run("(write (case (quote integer?) ((integer?) (quote matched-symbol)) (else (quote other))))")
    assert datum == "matched-symbol"
    print(json.dumps({"originalTimeoutSeconds": 2, "originalTimedOut": timed_out,
                      "correctedResults": result, "restArgumentProbe": rest,
                      "caseDatumProbe": datum}, indent=2))
