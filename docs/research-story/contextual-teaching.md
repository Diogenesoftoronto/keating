## V4.1: let the learner be a learner {#v41}

The first v4 cases made an important decision easy to spot: a learner asked for a
hint, then asked for a worked solution. The pilot exposed failures to follow that
change. Reviewing the benchmark itself revealed a second problem. We had given
the learner too much of the evaluator's language.

Real learners say “I keep getting this wrong,” or show a calculation. They rarely
ask “What does this attempt establish about what I know?” Those questions matter
to a teacher, but placing them in the learner's mouth can turn teaching judgment
into instruction following.

**V4.1 rewrites all 73 learner messages while preserving the twelve cases, ten
families and their session sequence.** The private rubric now asks whether help
fits the demonstrated work. Repeated confusion can call for an unsolicited
explanation. A productive attempt can call for space. A well-chosen example or
question can be useful in either setting; its teaching purpose decides the grade.

The original v4.0 freeze remains available, with its original pilot and 4/8 review.
V4.1 is a changed evaluation condition. The comparison below shows exactly what
changed before another model is scored.

<!-- REVISION_WORKBENCH -->

## The grading rule becomes a training signal {#contextual-training}

The next question followed directly: if the benchmark values appropriate help,
does training encourage it too? The historical SAE reward measured one narrow
failure, premature answer delivery under an explicit request for a hint. It was
useful for proving the pipeline. It could not decide the whole teaching problem.

We added a two-stage classification contract. First, assess **learner need** from
the conversation before teaching. Then locate **tutor-response spans** and assess
the delivered move's fit, substance and correctness. The action view includes
visible activity content, so an answer revealed inside a card counts as part of
the help. Later learner feedback remains available only to the hindsight path.

This borrows the separation of localization, classification and reward judgment
from [Features as Rewards, version 3](https://arxiv.org/html/2602.10067v3).
The teaching labels are our adaptation: appropriate help, overhelp, underhelp and
misdirected help. A question earns no automatic credit; an explanation incurs no
automatic penalty.

The same classifications now connect to the feature-only and combined F+S update
paths. At the default scale, appropriate substantive help receives **+1**, known
insubstantial help **0**, and context-mismatched or incorrect help **−1**. Unknown
judgments supply no training signal. Each action is counted once, regardless of
its length or number of highlighted spans.

**The new connection has passed 59 focused local tests**, including actual CPU
loss gradients, zero prompt-token gradients, saved-audit reconstruction and the
command-line path from classifier receipt to training plan. Those checks include
the existing custom updater and the historical reward path. Both v4 freezes and
the classifier's declared calibration/test families are excluded from the new
training export.

The delivered result is a working contextual grading-to-update path. The next
measurement is to fit and calibrate the broader readouts, then run matched
updates. The old narrow SAE head has not been relabeled as that new classifier,
and no additional hosted update is claimed for this revision.

| Evidence layer | What has happened | What comes next |
| --- | --- | --- |
| V4.0 challenge | One of four live slots completed; the completed episode received 4/8 in independent model review. | Resolve the format and tool-loop failures. |
| V4.1 dialogue and rubric | All 73 learner turns revised; original v4.0 archived; contextual automatic grading implemented. | A new, complete model cohort under the revised condition. |
| Contextual training | Feature-only and F+S preparation, replay and gradient checks pass locally. | Calibrated contextual classifiers and a new hosted comparison. |
| Scientific outcome | Earlier two-action F/F+S runs preserved measured verdicts; S lost one pass. | Larger, diverse learning curves and independently measured gains. |
