/**
 * Story 5.4 T2.4 / T6.6 — snapshot/behavior scaffold for `UndoToast`.
 *
 * Authored as a runner-ready spec; the `ui` package does not wire a
 * test runner today (see `packages/ui/package.json`). Same posture
 * as `NoExpiryConfirmDialog.test.tsx`.
 */
// @ts-nocheck — runs only when the ui package wires a test runner.
import { act, fireEvent, render } from "@testing-library/react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { REVOKE_UNDO_BUTTON_PT_BR } from "@healthtracker/validators";

import { UndoToast } from "./UndoToast";

describe("UndoToast — 5s deferred-write undo (Story 5.4)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires onTimeout exactly at durationMs (5000ms)", () => {
    const onTimeout = vi.fn();
    render(
      <UndoToast
        visible
        toastId="t1"
        message="Acesso revogado. Desfazer?"
        undoLabel={REVOKE_UNDO_BUTTON_PT_BR}
        onUndo={() => undefined}
        onTimeout={onTimeout}
        durationMs={5000}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(4999);
    });
    expect(onTimeout).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("tapping Desfazer fires onUndo and never onTimeout", () => {
    const onTimeout = vi.fn();
    const onUndo = vi.fn();
    const { getByText } = render(
      <UndoToast
        visible
        toastId="t2"
        message="Acesso revogado. Desfazer?"
        undoLabel={REVOKE_UNDO_BUTTON_PT_BR}
        onUndo={onUndo}
        onTimeout={onTimeout}
        durationMs={5000}
      />,
    );
    fireEvent.press(getByText(REVOKE_UNDO_BUTTON_PT_BR));
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("does not render when visible=false", () => {
    const { queryByText } = render(
      <UndoToast
        visible={false}
        toastId="t3"
        message="Acesso revogado. Desfazer?"
        undoLabel={REVOKE_UNDO_BUTTON_PT_BR}
        onUndo={() => undefined}
        onTimeout={() => undefined}
      />,
    );
    expect(queryByText(REVOKE_UNDO_BUTTON_PT_BR)).toBeNull();
  });
});
