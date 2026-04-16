= Limitations

The strongest limitation is scope. No human participants were studied, no intervention was preregistered, and the archival labels do not currently include inter-rater agreement or scorer provenance. The present paper should therefore be read as a systems-and-methods paper with an audited archival evaluation, not as a completed human-learning trial.

A second limitation is harness shape. The current benchmark strongly rewards retrieval pressure and overload control, but is less sensitive to reflective depth in isolation. That limitation is not hidden; it is part of what the metaharness diagnosis reveals.

A third limitation is reward hacking. The optimizer is explicitly trained against an inspectable synthetic score, and we did not yet test whether a policy can improve that score by exploiting benchmark quirks rather than by becoming pedagogically better. The ablation results make this risk concrete: retrieval pressure and challenge control are heavily rewarded, so a search procedure may learn to over-optimize exactly those levers if no countervailing audit exists.

A fourth limitation is data volume. Four topics are enough for informative failure analysis, but not enough for stable cross-domain claims about all forms of instruction.

A fifth limitation is evaluation lag relative to the live system. The new cadence-aware engagement timeline, which logs lesson sessions and estimates overdue review topics from elapsed time and mastery, is implemented in the repository but not separately validated in the analyses reported here. Its educational value is plausible and consistent with spaced-repetition logic, but that is still an architectural claim until direct evidence is collected.

Several mitigations are straightforward and should be treated as near-term requirements rather than optional polish: maintain hidden holdout topics and hidden coefficient settings; evaluate candidate policies against multiple harness variants rather than one fixed score surface; add adversarial tests for degenerate strategies such as superficial retrieval spam or low-challenge benchmark gaming; and require periodic human audit or blinded rubric checks on candidate transcripts before accepting policy updates as genuinely better teaching.
