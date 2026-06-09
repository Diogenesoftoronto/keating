# Keating Fine-Tune Export on RunPod

1. Create a RunPod GPU pod with a CUDA/PyTorch image.
2. Upload this export directory to the pod.
3. Run:

```bash
pip install -r requirements.txt
python unsloth_train.py --data train.chatml.jsonl --out keating-lora
```

Use `train.alpaca.jsonl` if you exported Alpaca format only. Tune batch size, sequence length, and base model for your GPU memory.
