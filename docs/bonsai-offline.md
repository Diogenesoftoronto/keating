# Bonsai 2 27B offline

Keating's desktop offline model picker can download **Prism ML Bonsai 2 27B** for text and image conversations. Its runtime is separate from LiteRT and from the MiniCPM model used for independent judgement. Audio input uses Gemma rather than Bonsai. The native integration downloads its runtime and weights on request; they are not included in the standard desktop installer.

Bonsai's rotated ternary weights require [Prism's llama.cpp fork](https://github.com/PrismML-Eng/llama.cpp). Stock llama.cpp rejects the PTQ1_0/PQ2_0 packing, while older Q2_0 builds can produce incorrect output without the matching activation transform. The [official Bonsai demo](https://github.com/PrismML-Eng/Bonsai-demo) is the runtime reference. These files do not work with LiteRT, ordinary Ollama, or an arbitrary OpenAI-compatible server.

## Pinned installation

The installer verifies file length and SHA-256 before installation and resumes incomplete downloads. The native model uses about **6.59 GB of downloads** on Linux CPU: 5.95 GB language weights, 0.63 GB image projector, and the matching runtime archive. Extracted binaries need additional space. Keep at least 8 GB free on disk; 16 GB of RAM is a practical starting point. Keating uses a conservative availability policy: it excludes Bonsai on machines with less than 12 GB of physical RAM. This is a Keating policy rather than an upstream claim about a hard model minimum.

| Component | Pin | SHA-256 |
| --- | --- | --- |
| Runtime | `prism-b10743-adfffbe` | Each architecture has its own checksum in `desktop/src/bonsai-runtime.ts` |
| PTQ1_0 language model | Hugging Face revision `b072e1d3b35a0a630cece372c2127528e0994386` | `53107f530aa52eb00912263ab1ee29bd199261c87cd7b4ad4ca1318c1fe33ee3` |
| Q8_0 vision projector | Same revision | `6807ede61d570bb86ba34b756a0fa109edc33668604de867c6ea6d8f1d631903` |

The [model repository](https://huggingface.co/prism-ml/Ternary-Bonsai-2-27B-gguf) contains both language packings. Keating chooses PTQ1_0 to keep memory and downloads bounded. It always installs the projector so the image capability corresponds to the installed runtime.

| Desktop | Default runtime |
| --- | --- |
| Linux x64 or arm64 | Prism CPU binary |
| Windows x64 or arm64 | Prism CPU binary |
| macOS Intel | Prism CPU binary |
| macOS Apple Silicon | Prism Metal binary |

The development helper also offers `--backend cuda` for Linux x64, using Prism's CUDA 12.4 archive. It requires a compatible NVIDIA driver. CPU is the portable default on Linux and Windows; it can be substantially slower than GPU execution. On the verified Linux CPU smoke host, the first tiny text request took about 96 seconds including loading and prefill. This establishes functional fallback, not interactive performance on arbitrary hardware. Other platform/backend combinations are rejected rather than substituted with an incompatible binary. Mac Apple Silicon uses the Metal archive; a separate CPU-only archive for that platform is not selected.

## Development helper

Run from the repository with Bun:

```sh
bun desktop/scripts/prepare-bonsai.mjs download
bun desktop/scripts/prepare-bonsai.mjs status
bun desktop/scripts/prepare-bonsai.mjs ask --prompt "Explain Newton's second law in three sentences."
```

The default helper cache is `~/.cache/keating/bonsai-2-27b`. Use `--directory /path/to/cache` to choose another location. Downloads are resumable after interruption. The desktop app keeps its separate installation under its own application data directory. Model removal in Settings deletes only the selected Bonsai installation.

`serve` starts the same verified runtime for diagnostics and stops on Ctrl-C:

```sh
bun desktop/scripts/prepare-bonsai.mjs serve
```

The server binds **127.0.0.1:8433** and uses a fresh private authentication key for each process. The native bridge owns requests and cancellation; this diagnostic command does not expose an unauthenticated service or install a global daemon. No host/LAN bind option is offered. Another process already using that port causes startup failure; Keating does not reuse an unrelated server.

## Generation and device limits

Keating uses an 8,192-token context, one concurrent slot, and at most 512 generated tokens. It explicitly disables thinking in both the server and chat template, rather than consuming a short output budget on the model's default lengthy reasoning. Requests ask for a concise complete answer; an output limit is still a limit rather than a guarantee that every requested explanation fits. Image inputs use the pinned projector with a 64–256 image-token bound to control desktop latency and memory; this can sacrifice fine visual detail. WAV/audio input is rejected by this model route. Cancellation aborts the streaming local API request. Closing the app stops its server process.

Bonsai 27B is currently a **desktop** offline choice. The vendor also maintains Apple MLX/MLX-Swift forks, but running this model on iOS requires a separate compatible native runtime and device memory validation. The desktop GGUF integration does not establish iOS or Android LiteRT support.
