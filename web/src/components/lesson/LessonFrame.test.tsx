import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LessonFrame, LessonCallout, LessonScore } from "./LessonFrame";
import { AnswerTile, RoundProgress } from "../quiz/ActivityGame";
import { QuizCountdown } from "../quiz/QuizCountdown";
import { Plan } from "./StudyPlan";

describe("lesson presentation",()=>{
  test("header, prompt and footer follow reading order",()=>{
    const html = renderToStaticMarkup(<LessonFrame glyph="help" kind="Quick check" title="Bayes" tools="1 of 3" footer={<button>Check</button>}>What changes a posterior?</LessonFrame>);
    expect(html.indexOf("Bayes")).toBeLessThan(html.indexOf("What changes"));
    expect(html.indexOf("What changes")).toBeLessThan(html.indexOf("<footer"));
  });
  test("checked choices retain their keys and visible verdicts",()=>{
    for (const [status,label] of [["correct","Correct"],["wrong","Your answer"]] as const) {
      const html = renderToStaticMarkup(<AnswerTile label="Observed evidence" index={1} selected onClick={()=>{}} status={status}/>);
      expect(html).toContain('>B</span>');
      expect(html).toContain(label);
    }
  });
  test("current position and time urgency are readable",()=>{
    expect(renderToStaticMarkup(<RoundProgress current={2} resolved={1} total={8}/>)).toContain("Question 3 of 8");
    expect(renderToStaticMarkup(<QuizCountdown remaining={8} total={120}/>)).toContain("Critical");
  });
  test("grade counts include partial credit independently",()=>{
    const html = renderToStaticMarkup(<LessonScore score="1.5 of 3" correct={1} partly={1} missed={1} time="1:20"/>);
    for (const label of ["Score","Time","1.5 of 3","Correct","Partly","Not quite"]) expect(html).toContain(label);
  });
  test("every callout conveys its tone to assistive technology",()=>{
    for (const tone of ["info","warning","success","danger"]) {
      expect(renderToStaticMarkup(<LessonCallout tone={tone}>Example</LessonCallout>)).toContain(`class="lesson-sr">${tone}.`);
    }
  });
  test("only the first unfinished leaf offers Start; the storage scope is written",()=>{
    const html=renderToStaticMarkup(<Plan nodeId="plan" title="Practice" persistent={false} disabled={false} items={[{id:"stage",title:"Study",children:[{id:"done",title:"Read",status:"done"},{id:"next",title:"Recall"},{id:"last",title:"Explain"}]}]}/>);
    expect(html).toContain('aria-label="Start Recall"');
    expect(html).not.toContain('aria-label="Start Explain"');
    expect(html).toContain("Kept in this session");
    expect(html).toContain("Save to Materials");
  });
});
