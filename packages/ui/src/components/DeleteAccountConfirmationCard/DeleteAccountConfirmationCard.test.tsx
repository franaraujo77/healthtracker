/**
 * Story 5.6 T6.5 — snapshot/behavior scaffold for
 * `DeleteAccountConfirmationCard`. Authored as a runner-ready spec;
 * the `ui` package does not wire a test runner today (see
 * `packages/ui/package.json`). Same posture as
 * `UndoToast.test.tsx` and `RevokeConfirmDialog.test.tsx`.
 */
// @ts-nocheck — runs only when the ui package wires a test runner.
import { act, fireEvent, render } from "@testing-library/react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DELETE_ACCOUNT_CANCEL_BUTTON_PT_BR,
  DELETE_ACCOUNT_CONFIRM_WORD,
  DELETE_ACCOUNT_CONTINUE_BUTTON_PT_BR,
  DELETE_ACCOUNT_COUNTDOWN_MS,
} from "@healthtracker/validators";

import { DeleteAccountConfirmationCard } from "./DeleteAccountConfirmationCard";

describe("DeleteAccountConfirmationCard — Story 5.6 AC1", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("Continuar is disabled until input matches EXCLUIR", () => {
    const onTimeout = vi.fn();
    const { getByTestId } = render(
      <DeleteAccountConfirmationCard onTimeout={onTimeout} />,
    );
    const cta = getByTestId("delete-account-continue-button");
    expect(cta.props.accessibilityState?.disabled).toBe(true);
    fireEvent.changeText(
      getByTestId("delete-account-confirm-input"),
      DELETE_ACCOUNT_CONFIRM_WORD,
    );
    expect(cta.props.accessibilityState?.disabled).toBe(false);
  });

  it("fires onTimeout exactly at DELETE_ACCOUNT_COUNTDOWN_MS after Continuar", () => {
    const onTimeout = vi.fn();
    const { getByTestId } = render(
      <DeleteAccountConfirmationCard onTimeout={onTimeout} />,
    );
    fireEvent.changeText(
      getByTestId("delete-account-confirm-input"),
      DELETE_ACCOUNT_CONFIRM_WORD,
    );
    fireEvent.press(getByTestId("delete-account-continue-button"));
    act(() => {
      vi.advanceTimersByTime(DELETE_ACCOUNT_COUNTDOWN_MS - 1);
    });
    expect(onTimeout).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("Cancelar during cooldown clears timers and does NOT fire onTimeout", () => {
    const onTimeout = vi.fn();
    const onCancel = vi.fn();
    const { getByTestId } = render(
      <DeleteAccountConfirmationCard
        onTimeout={onTimeout}
        onCancel={onCancel}
      />,
    );
    fireEvent.changeText(
      getByTestId("delete-account-confirm-input"),
      DELETE_ACCOUNT_CONFIRM_WORD,
    );
    fireEvent.press(getByTestId("delete-account-continue-button"));
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    fireEvent.press(getByTestId("delete-account-cancel-button"));
    act(() => {
      vi.advanceTimersByTime(DELETE_ACCOUNT_COUNTDOWN_MS);
    });
    expect(onTimeout).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
