"""Owner-only, opt-in handoff of the existing local preview identity.

Without --upload this prints instructions only: no keyring or network access.
Never run the upload mode through an assistant; the owner invokes it locally.
"""
import argparse
import base64
import hashlib
import os
from pathlib import Path
import subprocess


REPOSITORY = "Diogenesoftoronto/keating"
SECRET_NAMES = (
    "KEATING_WINDOWS_SELF_SIGNED_CERTIFICATE_BASE64",
    "KEATING_WINDOWS_SELF_SIGNED_CERTIFICATE_PASSWORD",
)
KEYRING_ATTRIBUTES = ["application", "keating", "purpose", "windows-selfsigned-code-signing"]


def checked(args, *, input_bytes=None, environment=None):
    result = subprocess.run(args, input=input_bytes, env=environment, capture_output=True, timeout=60)
    if result.returncode:
        raise RuntimeError(f"{Path(args[0]).name} failed (exit {result.returncode}); credential-bearing output suppressed")
    return result.stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--upload", action="store_true", help="Explicit owner authorization to set the two dedicated GitHub Actions secrets")
    parser.add_argument("--pfx", type=Path, default=Path.home() / ".local/share/keating-signing/windows-selfsigned/keating-windows-selfsigned.pfx")
    args = parser.parse_args()
    if not args.upload:
        print("No credential access or upload performed.")
        print("Owner settings: https://github.com/" + REPOSITORY + "/settings/secrets/actions")
        print("Dedicated secret names: " + ", ".join(SECRET_NAMES))
        print("If choosing the GitHub runner, invoke this script yourself with --upload.")
        return
    if not args.pfx.is_file() or args.pfx.is_symlink() or args.pfx.stat().st_uid != os.getuid() or args.pfx.stat().st_mode & 0o077:
        raise RuntimeError("PFX must be a private regular file owned by the current user")
    pfx = args.pfx.read_bytes()
    password = checked(["/usr/bin/secret-tool", "lookup", *KEYRING_ATTRIBUTES]).rstrip(b"\n")
    if not password:
        raise RuntimeError("Existing signing password is absent from the OS keyring")
    environment = os.environ.copy()
    environment["KEATING_SIGNING_PASSWORD"] = password.decode("ascii")
    public_pem = checked([
        "/usr/bin/openssl", "pkcs12", "-in", str(args.pfx), "-passin", "env:KEATING_SIGNING_PASSWORD", "-clcerts", "-nokeys",
    ], environment=environment)
    certificate_der = checked(["/usr/bin/openssl", "x509", "-outform", "DER"], input_bytes=public_pem)
    pin = (Path(__file__).resolve().parent.parent / "signing/windows-selfsigned-fingerprint.txt").read_text().strip()
    if hashlib.sha256(certificate_der).hexdigest() != pin:
        raise RuntimeError("Existing PFX does not contain the approved pinned public certificate")
    for name, value in zip(SECRET_NAMES, (base64.b64encode(pfx), password)):
        checked(["gh", "secret", "set", name, "--repo", REPOSITORY], input_bytes=value)
        print("Configured dedicated secret: " + name)
    print("Owner handoff complete. No credential values were printed or written to the repository.")


if __name__ == "__main__":
    main()
