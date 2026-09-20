# /// script
# requires-python = ">=3.12"
# dependencies = ["matplotlib==3.10.*"]
# ///
"""Plot the captured native receipt failure and the locally tested timestamp rule."""
import json
from datetime import datetime
from pathlib import Path

import matplotlib.pyplot as plt

root = Path(__file__).resolve().parents[1]
fixture = json.loads((root / "test/fixtures/tui-future-document.json").read_text())
document = fixture["document"]
receipt = fixture["retryableJournal"]["receipts"][0]
source_time = datetime.fromisoformat(document["updatedAt"])
receipt_time = datetime.fromisoformat(receipt["createdAt"])
gap = (source_time - receipt_time).total_seconds()
assert gap > 0

plt.rcParams.update({"font.family": "DejaVu Sans", "svg.hashsalt": "keating-native-document-clock-v1",
                     "text.color": "#254e63", "axes.labelcolor": "#254e63",
                     "xtick.color": "#536570", "ytick.color": "#254e63"})
fig, ax = plt.subplots(figsize=(10, 4.4), facecolor="#fcfcf9")
ax.set_facecolor("#fcfcf9")
ax.axvline(0, color="#dce4e8", linewidth=1)
ax.axvline(gap, color="#dce4e8", linewidth=1)
positions = [gap, 0, 0, gap]
labels = ["Document's authored update time", "Actual submission time", "Before fix: resulting document", "Local replay: resulting document"]
colors = ["#0072B2", "#0072B2", "#C97900", "#00836B"]
ax.scatter(positions, range(4), c=colors, s=95, zorder=3)
ax.annotate("", xy=(gap, 3), xytext=(0, 3), arrowprops={"arrowstyle": "->", "color": "#00836B", "linewidth": 2})
ax.annotate(f"{gap:.3f} seconds behind the document", (0, 2), xytext=(14, 2),
            textcoords="offset points", color="#C97900", va="center", fontsize=10)
ax.set_yticks(range(4), labels)
ax.set_xticks([0, gap], [receipt_time.strftime("%H:%M:%S.%f")[:-3], source_time.strftime("%H:%M:%S.%f")[:-3]])
ax.set_xlabel("Recorded UTC times · 14 September 2026", labelpad=12)
ax.set_xlim(-0.4, gap + 0.6)
ax.set_ylim(3.6, -0.65)
ax.set_title("A valid answer failed because document time moved backwards", loc="left", fontweight="bold", pad=20, fontsize=13)
ax.spines[["top", "right", "left"]].set_visible(False)
ax.spines["bottom"].set_color("#dce4e8")
ax.tick_params(axis="y", length=0, pad=12)
fig.text(.03, .025, "Fix: preserve the later document timestamp. The receipt keeps the actual submission time.\nBlue = captured live data · orange = reproduced failure · green = verified local replay", fontsize=9, color="#536570")
fig.tight_layout(rect=(0, .14, 1, 1))
output = root / "docs/assets/native-document-clock.svg"
fig.savefig(output, facecolor=fig.get_facecolor())
plt.close(fig)
print(output)
