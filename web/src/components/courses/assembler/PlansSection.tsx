/** Saved study plans, each with per-module choices once the plan is ticked. */
import { BookOpen } from "lucide-react";
import { css } from "../../../../styled-system/css";
import type { SavedStudyPlanSource } from "../../../courses/course-assembly";
import { choiceClass } from "./styles";

export function PlansSection({
  plans,
  selected,
  selectedModules,
  onChoosePlan,
  onChooseModule,
}: {
  plans: readonly SavedStudyPlanSource[];
  selected: ReadonlySet<string>;
  selectedModules: Readonly<Record<string, ReadonlySet<string>>>;
  onChoosePlan(planId: string): void;
  onChooseModule(planId: string, moduleId: string): void;
}) {
  return (
  <section>
    <div
      className={css({
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: "1rem",
      })}
    >
      <h3
        className={css({
          display: "flex",
          alignItems: "center",
          gap: "0.45rem",
          fontFamily: "Georgia, serif",
          fontSize: "1.2rem",
        })}
      >
        <BookOpen size={17} /> Plans from your chats
      </h3>
      <span
        className={css({
          fontFamily: "var(--mono-display)",
          fontSize: "0.65rem",
          color: "var(--ink-soft)",
        })}
      >
        {plans.length}
      </span>
    </div>
    {plans.length ? (
      <div
        className={css({
          mt: "0.65rem",
          display: "grid",
          gap: "0.65rem",
        })}
      >
        {plans.map((plan) => (
          <article key={plan.id} className={choiceClass}>
            <input
              type="checkbox"
              checked={selected.has(plan.id)}
              onChange={() => onChoosePlan(plan.id)}
              aria-label={`Include ${plan.title}`}
            />
            <div>
              <strong
                className={css({
                  display: "block",
                  fontSize: "0.85rem",
                })}
              >
                {plan.title}
              </strong>
              <span
                className={css({
                  display: "block",
                  mt: "0.15rem",
                  fontSize: "0.7rem",
                  color: "var(--ink-soft)",
                })}
              >
                From “{plan.sessionTitle}”
              </span>
              {selected.has(plan.id) ? (
                <div
                  className={css({
                    mt: "0.55rem",
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "0.35rem",
                  })}
                >
                  {plan.items.map((item) => (
                    <label
                      key={item.id}
                      className={css({
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "0.3rem",
                        border: "1px solid var(--ink)",
                        bg:
                          (selectedModules[plan.id]?.has(item.id) ??
                          false)
                            ? "var(--course-wash, #ddebdd)"
                            : "var(--paper)",
                        px: "0.45rem",
                        py: "0.3rem",
                        fontSize: "0.68rem",
                      })}
                    >
                      <input
                        type="checkbox"
                        checked={
                          selectedModules[plan.id]?.has(item.id) ??
                          false
                        }
                        onChange={() =>
                          onChooseModule(plan.id, item.id)
                        }
                      />{" "}
                      {item.title}
                    </label>
                  ))}
                </div>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    ) : (
      <p
        className={css({
          mt: "0.5rem",
          fontSize: "0.78rem",
          color: "var(--ink-soft)",
          lineHeight: 1.5,
        })}
      >
        No saved StudyPlans yet. Ask Keating for a lesson plan in
        chat, then it will appear here.
      </p>
    )}
  </section>
  );
}
