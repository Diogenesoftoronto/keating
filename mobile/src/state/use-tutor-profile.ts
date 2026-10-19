/** The tutor persona and the learner's own background text, with their synchronous mirrors. */
import { type MutableRefObject, useCallback, useRef, useState } from "react";
import { DEFAULT_TEACHER_PERSONA } from "@/lib/persona";
import { resetPersona, savePersona } from "@/lib/persona-storage";
import { normalizeLearnerContext } from "@/lib/learner-context";
import { saveLearnerContext } from "@/lib/learner-context-storage";

export interface TutorProfile {
  persona: string;
  personaRef: MutableRefObject<string>;
  setPersonaLocal(text: string): void;
  learnerContext: string;
  learnerContextRef: MutableRefObject<string>;
  setLearnerContextLocal(text: string): void;
  setPersona(text: string): Promise<void>;
  restoreDefaultPersona(): Promise<void>;
  setLearnerContext(text: string): Promise<void>;
}

/** Empty or whitespace-only personas fall back to the default teacher. */
export function personaOrDefault(text: string): string {
  return text.trim().length > 0 ? text : DEFAULT_TEACHER_PERSONA;
}

export function useTutorProfile(): TutorProfile {
  const [persona, setPersonaState] = useState<string>(DEFAULT_TEACHER_PERSONA);
  const [learnerContext, setLearnerContextState] = useState("");
  const personaRef = useRef(persona);
  const learnerContextRef = useRef(learnerContext);
  personaRef.current = persona;
  learnerContextRef.current = learnerContext;

  const setPersonaLocal = useCallback((text: string) => {
    personaRef.current = text;
    setPersonaState(text);
  }, []);

  const setLearnerContextLocal = useCallback((text: string) => {
    learnerContextRef.current = text;
    setLearnerContextState(text);
  }, []);

  const setPersona = useCallback(async (text: string) => {
    const next = personaOrDefault(text);
    await savePersona(next);
    setPersonaLocal(next);
  }, [setPersonaLocal]);

  const setLearnerContext = useCallback(async (text: string) => {
    const next = normalizeLearnerContext(text);
    await saveLearnerContext(next);
    setLearnerContextLocal(next);
  }, [setLearnerContextLocal]);

  const restoreDefaultPersona = useCallback(async () => {
    await resetPersona();
    setPersonaLocal(DEFAULT_TEACHER_PERSONA);
  }, [setPersonaLocal]);

  return {
    persona, personaRef, setPersonaLocal, learnerContext, learnerContextRef, setLearnerContextLocal,
    setPersona, restoreDefaultPersona, setLearnerContext,
  };
}
