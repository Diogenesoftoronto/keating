= Limitations

The strongest limitation is population validity. No human participants were studied. The archival "learners" are language models assigned a student role, and the labels do not include scorer provenance, blinded review, or inter-rater agreement. The archive supports descriptive systems analysis only.

A second limitation is harness validity. The deterministic benchmark strongly rewards lower modeled overload and retrieval practice, while maximum diagram bias and higher reflection bias are negative in isolation. Those sensitivities are properties of the implemented equations. They are not validated measures of human mastery, retention, engagement, transfer, or confusion.

A third limitation is optimizer safety. In 30 isolated MAP-Elites reruns, standardized reevaluation of the PROSPER-selected policy regressed 15 times, tied four times, and improved 11 times, with a mean delta near zero. Co-evolved objective weights and candidate-specific seeds can make raw search scores look favorable without establishing improvement under a common comparison. Production adds a real-evidence threshold and transactional rollback, but this study does not evaluate those protections against adversarial or long-horizon policy drift.

A fourth limitation is reward hacking. The optimizer is evaluated against an inspectable score surface, and we did not test hidden metrics, perturbed coefficients, adversarial policies, or external human judgments. An optimizer may learn benchmark regularities more quickly than it learns pedagogy.

A fifth limitation is data volume. Sixteen retained traces across four topics and four learner models are enough to surface failure cases, but not enough for stable cross-domain or model-family claims. The timestamp curation rule prevents cherry-picking among duplicates; it does not make the resulting sample representative.

A sixth limitation is evaluation lag relative to the product. Keating 3.3.0 includes persistent quizzes and flashcards, revisit scheduling, live audio/video teaching, browser and remote execution modes, collaborative courses, and portable study artifacts. None of those subsystems receives a direct educational-outcome evaluation here. The engagement timeline is motivated by distributed-practice evidence @cepeda2006, but its exponential decay model, thresholds, and priority lanes remain engineering heuristics.

Near-term mitigations are concrete: maintain hidden holdout topics and coefficient settings; require candidate policies to pass scalar, weakest-topic, and multi-objective gates; evaluate against multiple harness variants; add adversarial strategies such as superficial retrieval spam and low-challenge gaming; version every study input; and require periodic blinded human audit before describing a policy update as better teaching.
