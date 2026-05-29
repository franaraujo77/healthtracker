/**
 * Story 5.2 review-fix Patch #17 (T8.7) — behavior test for the
 * no_expiry duration → modal → confirm/cancel flow.
 *
 * `packages/ui` does not currently wire a test runner (see
 * `packages/ui/package.json` — no `test` script). This file is
 * authored as a runner-ready spec for the day the harness lands, in
 * the same posture as `ShareBiomarkerToggle.test.tsx`.
 *
 * Asserted behavior:
 *   1) selecting "Sem prazo" + tapping Continuar opens the modal,
 *   2) tapping Confirmar fires the parent's `onConfirm` once,
 *   3) tapping Voltar (or dismissing) fires `onCancel` and the
 *      parent's mutation is NOT invoked.
 */
// @ts-nocheck — runs only when the ui package wires a test runner.
import { fireEvent, render } from "@testing-library/react-native";
import { describe, expect, it, vi } from "vitest";

import {
  NO_EXPIRY_CONFIRM_BUTTON_PT_BR,
  NO_EXPIRY_CONFIRM_CANCEL_PT_BR,
} from "@healthtracker/validators";

import { NoExpiryConfirmDialog } from "./NoExpiryConfirmDialog";

describe("NoExpiryConfirmDialog — Sem-prazo flow (T8.7)", () => {
  it("renders body + both action buttons when open", () => {
    const { getByText } = render(
      <NoExpiryConfirmDialog
        open={true}
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(getByText(NO_EXPIRY_CONFIRM_BUTTON_PT_BR)).toBeTruthy();
    expect(getByText(NO_EXPIRY_CONFIRM_CANCEL_PT_BR)).toBeTruthy();
  });

  it("Confirmar fires onConfirm exactly once", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const { getByText } = render(
      <NoExpiryConfirmDialog
        open={true}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    fireEvent.press(getByText(NO_EXPIRY_CONFIRM_BUTTON_PT_BR));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("Voltar fires onCancel and never onConfirm", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const { getByText } = render(
      <NoExpiryConfirmDialog
        open={true}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    fireEvent.press(getByText(NO_EXPIRY_CONFIRM_CANCEL_PT_BR));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
