"""Explicit frozen-observer/dictionary pairs; no weights or providers at import.

Profiles describe the observer only. Actor selection and training are separate.
Revisions and the selected SAE file hash must still be supplied by the caller.
"""
from dataclasses import dataclass
import re
from types import MappingProxyType

from observer_core import SAESpec


@dataclass(frozen=True)
class ObserverProfile:
    name: str
    model: str
    dictionary: str
    spec: SAESpec
    layers: int

    @property
    def card(self):
        return "https://huggingface.co/" + self.dictionary

    @property
    def dimensions(self):
        return {"hidden": self.spec.hidden, "width": self.spec.width, "top_k": self.spec.top_k}

    def validate_layer(self, layer, module, sae_file):
        if type(layer) is not int or not 0 <= layer < self.layers:
            raise ValueError(f"Invalid observer layer for {self.name}: expected 0–{self.layers - 1}")
        if module != f"language_model.layers.{layer}" or sae_file != f"layer{layer}.sae.pt":
            raise ValueError("Module/SAE layer mismatch: exact AutoModel residual block required")

    def validate_config(self, config):
        text = getattr(config, "text_config", config)
        if (getattr(text, "model_type", None) != "qwen3_5_text"
                or type(getattr(text, "hidden_size", None)) is not int
                or text.hidden_size != self.spec.hidden
                or type(getattr(text, "num_hidden_layers", None)) is not int
                or text.num_hidden_layers != self.layers):
            raise ValueError("Observer architecture does not match selected Qwen-Scope dictionary")


DEFAULT_PROFILE = "qwen3.5-9b-base"
PROFILES = MappingProxyType({p.name: p for p in (
    ObserverProfile(DEFAULT_PROFILE, "Qwen/Qwen3.5-9B-Base",
                    "Qwen/SAE-Res-Qwen3.5-9B-Base-W64K-L0_50", SAESpec(), 32),
    # Official pairing: the post-trained checkpoint has NO -Instruct suffix.
    # https://huggingface.co/Qwen/SAE-Res-Qwen3.5-27B-W80K-L0_50
    ObserverProfile("qwen3.5-27b", "Qwen/Qwen3.5-27B",
                    "Qwen/SAE-Res-Qwen3.5-27B-W80K-L0_50", SAESpec(5120, 81920, 50), 64),
)})
PIN_LENGTHS = MappingProxyType({"observer_revision": 40, "tokenizer_revision": 40,
                              "sae_revision": 40, "sae_sha256": 64})


def get_profile(name=DEFAULT_PROFILE):
    if not isinstance(name, str) or name not in PROFILES:
        raise ValueError(f"Unknown observer profile: {name!r}")
    return PROFILES[name]


def validate_pins(pins, *, expected=None):
    for field, length in PIN_LENGTHS.items():
        value = pins.get(field)
        if not isinstance(value, str) or re.fullmatch(r"[0-9a-f]{" + str(length) + r"}", value) is None:
            raise ValueError(f"Unpinned {field}: full immutable {'Hub commit' if length == 40 else 'SHA-256'} required")
    if expected is not None:
        if not isinstance(expected, dict) or set(expected) != set(PIN_LENGTHS):
            raise ValueError("Expected pins must contain exactly observer/tokenizer/SAE revisions and SAE SHA-256")
        validate_pins(expected)
        for field in PIN_LENGTHS:
            if pins[field] != expected[field]:
                raise ValueError(f"Pinned {field} mismatch")


def extraction_profile(args):
    """Preflight both CLI and injected loader calls before importing a runtime."""
    profile = get_profile(getattr(args, "profile", DEFAULT_PROFILE))
    profile.validate_layer(args.layer, args.module, f"layer{args.layer}.sae.pt")
    validate_pins({"observer_revision": args.model_revision, "tokenizer_revision": args.tokenizer_revision,
                   "sae_revision": args.sae_revision, "sae_sha256": args.sae_sha256})
    return profile


def manifest_profile(manifest, *, profile=None, expected_pins=None):
    """Missing profile means legacy 9B; never infer 27B from dimensions or IDs."""
    selected = get_profile(profile if profile is not None else manifest.get("observer_profile", DEFAULT_PROFILE))
    if "observer_profile" in manifest and manifest["observer_profile"] != selected.name:
        raise ValueError("Observer profile mismatch")
    if manifest.get("observer_model") != selected.model or manifest.get("tokenizer_model") != selected.model:
        raise ValueError("Observer/tokenizer identity mismatch for selected profile")
    if manifest.get("sae_model") != selected.dictionary:
        raise ValueError("Unexpected dictionary identity for selected profile")
    dimensions = manifest.get("dimensions")
    if (not isinstance(dimensions, dict) or dimensions != selected.dimensions
            or any(type(v) is not int for v in dimensions.values())):
        raise ValueError("Unexpected Qwen-Scope dimensions for selected profile")
    selected.validate_layer(manifest.get("layer"), manifest.get("module"), manifest.get("sae_file"))
    validate_pins(manifest, expected=expected_pins)
    if "model_card" in manifest and manifest["model_card"] != selected.card:
        raise ValueError("Dictionary model card mismatch")
    return selected
