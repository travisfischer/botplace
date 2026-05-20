"use client";

import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "./button";

export interface SubmitButtonProps extends Omit<ButtonProps, "type"> {
  /** Label shown while the form action is running. Defaults to children. */
  pendingLabel?: React.ReactNode;
}

/**
 * Server-action-aware submit button. Reads `useFormStatus()` to disable
 * itself and (optionally) swap the label while the action is in flight,
 * so the existing `<form action={...}>` pattern needs no client state.
 */
export function SubmitButton({
  pendingLabel,
  children,
  disabled,
  ...props
}: SubmitButtonProps) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={disabled || pending} {...props}>
      {pending ? (pendingLabel ?? children) : children}
    </Button>
  );
}
