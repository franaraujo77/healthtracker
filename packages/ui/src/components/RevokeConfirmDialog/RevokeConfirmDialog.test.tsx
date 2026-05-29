/**
 * Story 5.4 T6.6 — snapshot/behavior scaffold for `RevokeConfirmDialog`.
 *
 * `packages/ui` does not currently wire a test runner (see
 * `packages/ui/package.json` — no `test` script). Authored as a
 * runner-ready spec in the same posture as
 * `NoExpiryConfirmDialog.test.tsx`.
 */
// @ts-nocheck — runs only when the ui package wires a test runner.
import { fireEvent, render } from "@testing-library/react-native";
import { describe, expect, it, vi } from "vitest";

import {
  REVOKE_CONFIRM_BUTTON_PT_BR,
  REVOKE_CONFIRM_CANCEL_PT_BR,
} from "@healthtracker/validators";

import { RevokeConfirmDialog } from "./RevokeConfirmDialog";

describe("RevokeConfirmDialog — revoke ceremony (Story 5.4)", () => {
  it("renders body + both buttons when open", () => {
    const { getByText } = render(
      <RevokeConfirmDialog
        open={true}
        displayName="Dra. Renata"
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(getByText(REVOKE_CONFIRM_BUTTON_PT_BR)).toBeTruthy();
    expect(getByText(REVOKE_CONFIRM_CANCEL_PT_BR)).toBeTruthy();
    expect(getByText(/Dra. Renata perderá acesso aos seus dados/)).toBeTruthy();
  });

  it("Revogar fires onConfirm exactly once", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const { getByText } = render(
      <RevokeConfirmDialog
        open={true}
        displayName="Dra. Renata"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    fireEvent.press(getByText(REVOKE_CONFIRM_BUTTON_PT_BR));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("Cancelar fires onCancel and never onConfirm", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const { getByText } = render(
      <RevokeConfirmDialog
        open={true}
        displayName="Dra. Renata"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    fireEvent.press(getByText(REVOKE_CONFIRM_CANCEL_PT_BR));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
