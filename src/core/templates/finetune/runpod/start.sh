#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
pip install -r requirements.txt
python unsloth_train.py --data train.chatml.jsonl --out keating-lora
