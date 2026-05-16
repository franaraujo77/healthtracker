"use client";

import { styled, XStack, YStack } from "tamagui";

import { Input } from "./input";
import { Label } from "./label";

export const Field = styled(YStack, {
  name: "Field",
  gap: "$2",
  width: "100%",
});

export const FieldRow = styled(XStack, {
  name: "FieldRow",
  gap: "$2",
  alignItems: "center",
  width: "100%",
});

export function FieldGroup({
  label,
  children,
  htmlFor,
}: {
  label: string;
  children?: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <Field>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </Field>
  );
}

export function FieldInput({
  label,
  id,
  ...props
}: React.ComponentProps<typeof Input> & { label: string; id?: string }) {
  return (
    <Field>
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} {...props} />
    </Field>
  );
}
