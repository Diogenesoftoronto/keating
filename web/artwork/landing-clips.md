# Landing reaction clips

Selected on 2026-09-08 from the user's computer-frustration GIF references.
These are existing third-party reaction clips, not generated illustrations.

| Local asset | Source page | Downloaded media |
| --- | --- | --- |
| `public/landing/clips/office-rage.mp4` | https://tenor.com/view/frustrated-bad-day-at-the-office-gif-10914752 | https://media.tenor.com/uBpDd2ZIwEAAAAPo/frustrated-bad-day-at-the-office.mp4 |
| `public/landing/clips/moss-rage.mp4` | https://tenor.com/view/it-crowd-moss-computer-throw-gif-5404468 | https://media.tenor.com/LXpL4L2KuLIAAAPo/it-crowd.mp4 |

The office clip is the classic cubicle/CRT computer-rage scene (498×254,
4.5 seconds, 90 frames). The Moss clip is from *The IT Crowd*: Moss lifts and
throws his monitor (500×288, 1.7 seconds, 17 frames). This higher-resolution
Tenor clip was preferred to the cropped 160×160 alternative. The initially
suggested official Giphy link showed Roy instead of Moss and was not used.

Both downloads already used H.264. FFmpeg remuxed their video streams without
re-encoding, omitted audio, and moved the MP4 index to the start (`+faststart`).
The matching `office-rage.webp` and `moss-rage.webp` posters are the actual
first frames, encoded with libwebp at quality 90.

Verification: ffprobe checked duration, codec, dimensions and frame counts.
Contact sheets sampled across both complete clips were inspected to confirm
real movement and the requested scenes. Source URLs record provenance; this
file does not assert that the clips are original Keating artwork or licensed
under Keating's source-code license.
