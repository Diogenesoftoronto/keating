# Keating brand assets

Production-ready images live directly in this directory. High-resolution,
transparency-preserving source renders live in `masters/` and must not be
overwritten by cropping or card-size optimization.

When deriving a production asset:

1. Start from the corresponding file in `masters/`.
2. Export to a new working file, then replace only the intended production
   derivative after visual review.
3. Preserve the alpha channel and transparent canvas in both the master and
   derivative. Never flatten either file onto a colored background.

`cap-evolutionary.png` is the card-sized derivative of
`masters/cap-evolutionary-master.png`.
