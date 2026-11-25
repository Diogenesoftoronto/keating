## Shared conventions

- Every config is plain JSON: no functions, no JSX, no comments in what you send.
- Every component offers **Share with Keating** as soon as the learner has done anything (partial progress
  included), plus **Undo**, **Start over** and a **Use buttons instead** panel for the non-drag path.
  Keating's follow-up reply is computed from what the learner did. Fields such as `why`, `reply`, `verdict` and `perfectReply` are what that feedback says, so write
  them as Keating would speak: concrete, short, about this case.
- Ids are short ASCII words. Each component states its own id rule (`/^[A-Za-z0-9_-]{1,40}$/` and so on),
  and that rule is enforced. Labels, titles, symbols and names (σ, Δt, v₀) may use any Unicode.
- Text limits below are character counts, enforced by the validators unless marked *(advice)*.
