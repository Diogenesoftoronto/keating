import React, { useState } from "react";
import { Box, Text, render, useApp, useInput } from "ink";

import { type KeatingConfig } from "../core/config.js";

export interface SetupAnswers {
  runtimePreference: KeatingConfig["pi"]["runtimePreference"];
  defaultProvider: string;
  defaultModel: string;
  defaultThinking: string;
}

interface Choice<T extends string = string> {
  label: string;
  value: T;
  hint?: string;
}

const PROVIDERS: Choice[] = [
  { label: "Google", value: "google", hint: "Recommended" },
  { label: "OpenAI", value: "openai" },
  { label: "Anthropic", value: "anthropic" },
  { label: "Custom", value: "custom", hint: "Type a provider name" }
];

const MODELS_BY_PROVIDER: Record<string, Choice[]> = {
  google: [
    { label: "Gemini 3.1 Pro Preview", value: "gemini-3.1-pro-preview", hint: "Recommended" },
    { label: "Gemini 3.1 Flash Live Preview", value: "gemini-3.1-flash-live-preview" },
    { label: "Custom", value: "custom", hint: "Type a model name" }
  ],
  openai: [
    { label: "GPT-5.2", value: "gpt-5.2" },
    { label: "GPT-5.4", value: "gpt-5.4" },
    { label: "Custom", value: "custom", hint: "Type a model name" }
  ],
  anthropic: [
    { label: "Claude Sonnet 4.5", value: "claude-sonnet-4-5" },
    { label: "Custom", value: "custom", hint: "Type a model name" }
  ],
  custom: [
    { label: "Custom", value: "custom", hint: "Type a model name" }
  ]
};

const THINKING: Choice[] = [
  { label: "Medium", value: "medium", hint: "Recommended" },
  { label: "Low", value: "low" },
  { label: "High", value: "high" }
];

const RUNTIMES: Choice<KeatingConfig["pi"]["runtimePreference"]>[] = [
  { label: "Prefer standalone", value: "prefer-standalone", hint: "Recommended" },
  { label: "Embedded only", value: "embedded-only" },
  { label: "Standalone only", value: "standalone-only" }
];

function selectedIndex<T extends string>(choices: Choice<T>[], value: string | undefined): number {
  const index = choices.findIndex((choice) => choice.value === value);
  return index >= 0 ? index : 0;
}

function Menu<T extends string>(props: {
  title: string;
  choices: Choice<T>[];
  selected: number;
  setSelected: (index: number) => void;
  submit: () => void;
}): React.ReactElement {
  useInput((input: string, key: any) => {
    if (key.upArrow) props.setSelected((props.selected - 1 + props.choices.length) % props.choices.length);
    else if (key.downArrow) props.setSelected((props.selected + 1) % props.choices.length);
    else if (key.return || input === " ") props.submit();
  });

  return React.createElement(
    Box,
    { flexDirection: "column" },
    React.createElement(Text, { color: "green", bold: true }, props.title),
    ...props.choices.map((choice, index) =>
      React.createElement(
        Text,
        { key: choice.value, color: index === props.selected ? "green" : undefined },
        `${index === props.selected ? ">" : " "} ${choice.label}${choice.hint ? ` - ${choice.hint}` : ""}`
      )
    ),
    React.createElement(Text, { dimColor: true }, "Use arrow keys and Enter.")
  );
}

function TextPrompt(props: {
  title: string;
  initialValue: string;
  submit: (value: string) => void;
}): React.ReactElement {
  const [value, setValue] = useState(props.initialValue);

  useInput((input: string, key: any) => {
    if (key.return) props.submit(value.trim() || props.initialValue);
    else if (key.backspace || key.delete) setValue((current) => current.slice(0, -1));
    else if (!key.ctrl && input) setValue((current) => current + input);
  });

  return React.createElement(
    Box,
    { flexDirection: "column" },
    React.createElement(Text, { color: "green", bold: true }, props.title),
    React.createElement(Text, null, `> ${value}`),
    React.createElement(Text, { dimColor: true }, "Type a value and press Enter.")
  );
}

function Summary(props: {
  answers: SetupAnswers;
  selected: number;
  setSelected: (index: number) => void;
  submit: (confirmed: boolean) => void;
}): React.ReactElement {
  const choices: Choice<"yes" | "back">[] = [
    { label: "Write config", value: "yes" },
    { label: "Go back", value: "back" }
  ];

  useInput((input: string, key: any) => {
    if (key.upArrow || key.downArrow) props.setSelected(props.selected === 0 ? 1 : 0);
    else if (key.return || input === " ") props.submit(choices[props.selected]?.value === "yes");
  });

  return React.createElement(
    Box,
    { flexDirection: "column" },
    React.createElement(Text, { color: "green", bold: true }, "Confirm Keating setup"),
    React.createElement(Text, null, `Provider: ${props.answers.defaultProvider}`),
    React.createElement(Text, null, `Model: ${props.answers.defaultModel}`),
    React.createElement(Text, null, `Thinking: ${props.answers.defaultThinking}`),
    React.createElement(Text, null, `Runtime: ${props.answers.runtimePreference}`),
    React.createElement(Text, null, ""),
    ...choices.map((choice, index) =>
      React.createElement(
        Text,
        { key: choice.value, color: index === props.selected ? "green" : undefined },
        `${index === props.selected ? ">" : " "} ${choice.label}`
      )
    )
  );
}

function SetupApp(props: {
  initial: SetupAnswers;
  onComplete: (answers: SetupAnswers) => void;
}): React.ReactElement {
  const app = useApp();
  const [step, setStep] = useState<"provider" | "customProvider" | "model" | "customModel" | "thinking" | "runtime" | "summary">("provider");
  const [answers, setAnswers] = useState<SetupAnswers>(props.initial);
  const [providerIndex, setProviderIndex] = useState(selectedIndex(PROVIDERS, props.initial.defaultProvider));
  const [modelIndex, setModelIndex] = useState(0);
  const [thinkingIndex, setThinkingIndex] = useState(selectedIndex(THINKING, props.initial.defaultThinking));
  const [runtimeIndex, setRuntimeIndex] = useState(selectedIndex(RUNTIMES, props.initial.runtimePreference));
  const [summaryIndex, setSummaryIndex] = useState(0);

  useInput((input: string, key: any) => {
    if (key.escape || (key.ctrl && input === "c")) app.exit();
  });

  if (step === "provider") {
    return React.createElement(Menu, {
      title: "Choose default provider",
      choices: PROVIDERS,
      selected: providerIndex,
      setSelected: setProviderIndex,
      submit: () => {
        const provider = PROVIDERS[providerIndex]?.value ?? "google";
        if (provider === "custom") setStep("customProvider");
        else {
          const models = MODELS_BY_PROVIDER[provider] ?? MODELS_BY_PROVIDER.custom;
          setAnswers((current) => ({ ...current, defaultProvider: provider, defaultModel: models[0]?.value ?? current.defaultModel }));
          setModelIndex(0);
          setStep("model");
        }
      }
    });
  }

  if (step === "customProvider") {
    return React.createElement(TextPrompt, {
      title: "Custom provider name",
      initialValue: answers.defaultProvider === "custom" ? "google" : answers.defaultProvider,
      submit: (value) => {
        setAnswers((current) => ({ ...current, defaultProvider: value }));
        setStep("customModel");
      }
    });
  }

  if (step === "model") {
    const models = MODELS_BY_PROVIDER[answers.defaultProvider] ?? MODELS_BY_PROVIDER.custom;
    return React.createElement(Menu, {
      title: "Choose default model",
      choices: models,
      selected: modelIndex,
      setSelected: setModelIndex,
      submit: () => {
        const model = models[modelIndex]?.value ?? "custom";
        if (model === "custom") setStep("customModel");
        else {
          setAnswers((current) => ({ ...current, defaultModel: model }));
          setStep("thinking");
        }
      }
    });
  }

  if (step === "customModel") {
    return React.createElement(TextPrompt, {
      title: "Custom model name",
      initialValue: answers.defaultModel,
      submit: (value) => {
        setAnswers((current) => ({ ...current, defaultModel: value }));
        setStep("thinking");
      }
    });
  }

  if (step === "thinking") {
    return React.createElement(Menu, {
      title: "Choose thinking effort",
      choices: THINKING,
      selected: thinkingIndex,
      setSelected: setThinkingIndex,
      submit: () => {
        setAnswers((current) => ({ ...current, defaultThinking: THINKING[thinkingIndex]?.value ?? "medium" }));
        setStep("runtime");
      }
    });
  }

  if (step === "runtime") {
    return React.createElement(Menu, {
      title: "Choose runtime preference",
      choices: RUNTIMES,
      selected: runtimeIndex,
      setSelected: setRuntimeIndex,
      submit: () => {
        setAnswers((current) => ({ ...current, runtimePreference: RUNTIMES[runtimeIndex]?.value ?? "prefer-standalone" }));
        setStep("summary");
      }
    });
  }

  return React.createElement(Summary, {
    answers,
    selected: summaryIndex,
    setSelected: setSummaryIndex,
    submit: (confirmed) => {
      if (confirmed) {
        props.onComplete(answers);
        app.exit();
      } else {
        setStep("provider");
      }
    }
  });
}

export async function runInteractiveSetup(initial: SetupAnswers): Promise<SetupAnswers | null> {
  let completed: SetupAnswers | null = null;
  const instance = render(React.createElement(SetupApp, {
    initial,
    onComplete: (answers) => {
      completed = answers;
    }
  }));

  await instance.waitUntilExit();
  return completed;
}
