import { useCallback, useState } from "react";
import { ArrowRight, CheckCircle2, HelpCircle, MessageSquare } from "lucide-react";

export interface QuestionData {
 question: string;
 choices?: string[];
 allow_text?: boolean;
 hint?: string;
}

interface QuestionRendererProps {
 data: QuestionData;
 onAnswer?: (answer: string) => void;
}

export function QuestionRenderer({ data, onAnswer }: QuestionRendererProps) {
 const [selectedChoice, setSelectedChoice] = useState<string | null>(null);
 const [textInput, setTextInput] = useState("");
 const [submitted, setSubmitted] = useState(false);
 const [submittedAnswer, setSubmittedAnswer] = useState<string | null>(null);

 const canSubmit = submitted
 ? false
 : data.choices
 ? selectedChoice !== null
 : textInput.trim().length > 0;

 const handleSubmit = useCallback(() => {
 if (!canSubmit) return;
 const answer = data.choices ? selectedChoice! : textInput.trim();
 setSubmittedAnswer(answer);
 setSubmitted(true);
 onAnswer?.(answer);
 }, [canSubmit, data.choices, selectedChoice, textInput, onAnswer]);

 return (
 <div className="my-3 rounded-xl border border-primary/30 bg-primary/5 p-4 shadow-sm">
 <div className="flex items-start gap-3">
 <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
 <HelpCircle size={18} className="text-primary" />
 </div>
 <div className="min-w-0 flex-1 space-y-3">
 <p className="text-sm font-medium leading-6">{data.question}</p>

 {data.choices && data.choices.length > 0 && (
 <div className="space-y-2">
 {data.choices.map((choice) => {
 const isSelected = selectedChoice === choice;
 const isSubmittedChoice = submitted && submittedAnswer === choice;
 return (
 <button
 key={choice}
 type="button"
 disabled={submitted}
 className={`flex w-full items-center gap-3 rounded-lg border-2 px-4 py-3 text-left text-sm transition-all ${
 isSubmittedChoice
 ? "border-primary bg-primary/15 text-primary"
 : isSelected
 ? "border-primary bg-primary/10 text-primary"
 : "border-border bg-background hover:border-primary/50"
 } ${submitted ? "cursor-not-allowed opacity-70" : "cursor-pointer"}`}
 onClick={() => !submitted && setSelectedChoice(choice)}
 >
 {isSubmittedChoice ? (
 <CheckCircle2 size={16} className="shrink-0" />
 ) : isSelected ? (
 <CheckCircle2 size={16} className="shrink-0" />
 ) : (
 <div className="h-4 w-4 shrink-0 rounded-full border-2 border-border" />
 )}
 <span className="flex-1">{choice}</span>
 </button>
 );
 })}
 </div>
 )}

 {data.allow_text && (
 <div className="space-y-2">
 {data.choices && data.choices.length > 0 && (
 <div className="flex items-center gap-2 text-xs text-muted-foreground">
 <div className="h-px flex-1 bg-border" />
 <span>or type your answer</span>
 <div className="h-px flex-1 bg-border" />
 </div>
 )}
 <div className="flex gap-2">
 <input
 type="text"
 className="h-9 flex-1 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary"
 placeholder="Your answer..."
 value={textInput}
 disabled={submitted}
 onChange={(e) => setTextInput(e.target.value)}
 onKeyDown={(e) => {
 if (e.key === "Enter" && canSubmit) handleSubmit();
 }}
 />
 </div>
 </div>
 )}

 {data.hint && !submitted && (
 <p className="text-xs text-muted-foreground italic">
 💡 {data.hint}
 </p>
 )}

 {!submitted && (
 <button
 type="button"
 disabled={!canSubmit}
 className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
 onClick={handleSubmit}
 >
 <ArrowRight size={16} />
 Answer
 </button>
 )}

 {submitted && (
 <div className="flex items-center gap-2 text-sm text-primary">
 <MessageSquare size={14} />
 <span>Answered: <strong>{submittedAnswer}</strong></span>
 </div>
 )}
 </div>
 </div>
 </div>
 );
}
