import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { OpenUIPreview } from "../components/OpenUIPreview";
import { buildOpenUIPreview } from "../keating/openui/preview";
import { learnerResponseReviewMarkdown } from "../keating/learner-response";
import { stripReviewNotice, withReviewNotice } from "../keating/judgement/review-notice";
import { readFileSync } from "node:fs";

const render = (text: string) => renderToStaticMarkup(<OpenUIPreview blocks={buildOpenUIPreview(learnerResponseReviewMarkdown(stripReviewNotice(text)))} />);

test("shared replies show components as summaries, never as raw source", () => {
  const reply = withReviewNotice("unverified", [
    "Here's a quick check.",
    "```openui lifecycle=ephemeral id=q1",
    'root = LearningSurface([q], "Check", "", "ephemeral")',
    'q = Question([{ header: "Choice", question: "Which input changes a posterior?", type: "choice", choices: ["Evidence", "Font"] }], "ephemeral", "Bayes")',
    "```",
    "Then we continue.",
  ].join("\n"));
  const html = render(reply);
  expect(html).toContain("Here&#x27;s a quick check.");
  expect(html).toContain("Then we continue.");
  expect(html).toContain("1 question");
  expect(html).not.toContain("preview unavailable");
  expect(html).not.toContain("LearningSurface(");
  expect(html).not.toContain("keating:review");
});

test("the share page renders messages through the inert preview", () => {
  const page = readFileSync(new URL("../pages/SharedSession.tsx", import.meta.url), "utf8");
  expect(page).toContain("<OpenUIPreview blocks={sharedMessageBlocks(message)} />");
  expect(page).not.toContain("<MarkdownBlock content={messageText(message)} />");
});
