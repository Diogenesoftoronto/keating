import { Children, Fragment, forwardRef, isValidElement, useCallback, useId, useRef, useState, type ComponentPropsWithoutRef, type ReactNode } from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check } from "reicon-react/icons/Check";
import { ChevronDown } from "reicon-react/icons/ChevronDown";
import { ChevronUp } from "reicon-react/icons/ChevronUp";
import { fieldInput } from "../../styled-system/recipes";
import "./select.css";

export interface SelectProps extends Omit<ComponentPropsWithoutRef<"button">, "children" | "value" | "defaultValue" | "onChange" | "name"> {
  value: string | number;
  onValueChange: (value: string) => void;
  /** Declare choices with option / optgroup elements, including fragments and mapped arrays. */
  children: ReactNode;
  name?: string;
  required?: boolean;
  placeholder?: string;
}

type Choice = { kind: "option"; key: string; value: string; text: string; disabled: boolean; hidden: boolean };
type ChoiceGroup = { kind: "group"; key: string; label: string; choices: Choice[] };

function optionText(children: ReactNode): string {
  return Children.toArray(children).map((child) => typeof child === "string" || typeof child === "number"
    ? String(child)
    : isValidElement<{ children?: ReactNode }>(child) ? optionText(child.props.children) : "").join("");
}

function choicesFrom(children: ReactNode, prefix = "", groupDisabled = false): Array<Choice | ChoiceGroup> {
  return Children.toArray(children).flatMap((child, index): Array<Choice | ChoiceGroup> => {
    if (!isValidElement(child)) return [];
    const key = `${prefix}${child.key ?? index}`;
    if (child.type === Fragment) return choicesFrom((child.props as { children?: ReactNode }).children, `${key}/`, groupDisabled);
    if (child.type === "option") {
      const props = child.props as ComponentPropsWithoutRef<"option">;
      const text = props.label ?? optionText(props.children);
      return [{ kind: "option", key, value: String(props.value ?? text), text, disabled: groupDisabled || Boolean(props.disabled), hidden: Boolean(props.hidden) }];
    }
    if (child.type === "optgroup") {
      const props = child.props as ComponentPropsWithoutRef<"optgroup">;
      return [{ kind: "group", key, label: props.label ?? "", choices: choicesFrom(props.children, `${key}/`, groupDisabled || Boolean(props.disabled)).flatMap((item) => item.kind === "option" ? [item] : item.choices) }];
    }
    return [];
  });
}

/** Controlled, keyboard-accessible single select with the same option declarations as a native select. */
export const Select = forwardRef<HTMLButtonElement, SelectProps>(function Select({
  value, onValueChange, children, name, required, disabled, placeholder = "Choose an option", className, form, ...triggerProps
}, forwardedRef) {
  const instanceId = useId();
  const trigger = useRef<HTMLButtonElement | null>(null);
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
  const choices = choicesFrom(children);
  const options = choices.flatMap((choice) => choice.kind === "option" ? [choice] : choice.choices);
  const stringValue = String(value);
  // A per-instance sentinel cannot collide with an authored option, including unusual saved values.
  let emptyValue = `__keating_select_empty_${instanceId}`;
  while (options.some((option) => option.value === emptyValue)) emptyValue += "_";
  const encode = (optionValue: string) => optionValue === "" ? emptyValue : optionValue;
  const selected = options.find((option) => option.value === stringValue);
  const setTrigger = useCallback((node: HTMLButtonElement | null) => {
    trigger.current = node;
    if (typeof forwardedRef === "function") forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
    setPortalContainer(node?.closest("dialog") ?? null);
  }, [forwardedRef]);

  const renderOption = (option: Choice) => option.hidden ? null : <SelectPrimitive.Item key={option.key} value={encode(option.value)} disabled={option.disabled} textValue={option.text} className="keating-select-option">
    <SelectPrimitive.ItemText>{option.text}</SelectPrimitive.ItemText>
    <SelectPrimitive.ItemIndicator className="keating-select-option__check"><Check size={17} aria-hidden="true" /></SelectPrimitive.ItemIndicator>
  </SelectPrimitive.Item>;

  return <>
    <SelectPrimitive.Root value={selected ? encode(stringValue) : ""} onValueChange={(next) => onValueChange(next === emptyValue ? "" : next)} disabled={disabled} required={required}>
      <SelectPrimitive.Trigger {...triggerProps} ref={setTrigger} form={form} type="button" className={[fieldInput({ size: "auto" }), "keating-select", className].filter(Boolean).join(" ")} aria-required={required || undefined}>
        <span className="keating-select__value"><SelectPrimitive.Value placeholder={placeholder}>{selected?.text}</SelectPrimitive.Value></span>
        <SelectPrimitive.Icon className="keating-select__icon"><ChevronDown size={17} aria-hidden="true" /></SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal container={portalContainer}>
        <SelectPrimitive.Content className="keating-select-menu" position="popper" align="start" sideOffset={6} collisionPadding={8} avoidCollisions>
          <SelectPrimitive.ScrollUpButton className="keating-select-scroll"><ChevronUp size={16} aria-hidden="true" /></SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className="keating-select-viewport">
            {choices.map((choice) => choice.kind === "option" ? renderOption(choice) : <SelectPrimitive.Group key={choice.key}>
              <SelectPrimitive.Label className="keating-select-group">{choice.label}</SelectPrimitive.Label>
              {choice.choices.map(renderOption)}
            </SelectPrimitive.Group>)}
          </SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className="keating-select-scroll"><ChevronDown size={16} aria-hidden="true" /></SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
    {/* Keep real form/autofill semantics without leaking the internal empty-option sentinel. */}
    <select className="keating-select-native" aria-hidden="true" tabIndex={-1} name={name} form={form} required={required} disabled={disabled} value={stringValue}
      onChange={(event) => onValueChange(event.currentTarget.value)} onInvalid={(event) => { event.preventDefault(); trigger.current?.focus(); }}>
      {!selected ? <option value="" /> : null}
      {options.map((option) => <option key={option.key} value={option.value} disabled={option.disabled} hidden={option.hidden}>{option.text}</option>)}
    </select>
  </>;
});
