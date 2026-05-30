"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  STALENESS_THRESHOLD_DAYS_LABEL_PT_BR,
  STALENESS_THRESHOLD_DEFAULT_HINT_PT_BR,
  STALENESS_THRESHOLD_MAX_DAYS,
  STALENESS_THRESHOLD_MIN_DAYS,
  STALENESS_THRESHOLD_RANGE_ERROR_PT_BR,
  STALENESS_THRESHOLD_SAVE_CTA_LOADING_PT_BR,
  STALENESS_THRESHOLD_SAVE_CTA_PT_BR,
  STALENESS_THRESHOLD_SAVE_ERROR_PT_BR,
  STALENESS_THRESHOLD_SAVE_TOAST_PT_BR,
} from "@healthtracker/validators";

import { useTRPC } from "~/trpc/react";

interface CategoryRow {
  biomarkerCategory: string;
  labelPtBr: string;
  thresholdDays: number;
  isDefault: boolean;
}

export function StalenessThresholdsForm(props: {
  initialCategories: CategoryRow[];
  defaultDays: number;
}) {
  const trpc = useTRPC();
  const router = useRouter();
  const queryClient = useQueryClient();

  // Local form state — row index → current value (string for input).
  const [rows, setRows] = useState(
    props.initialCategories.map((c) => ({
      biomarkerCategory: c.biomarkerCategory,
      labelPtBr: c.labelPtBr,
      value: String(c.thresholdDays),
      isDefault: c.isDefault,
      touched: false,
    })),
  );
  const [toast, setToast] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);

  // R1-followup LOW-1 — auto-clear toast after 4s so a stale "Salvo"
  // doesn't sit in the viewport forever. Cleanup on unmount + on every
  // new toast supersedes prior timers.
  useEffect(() => {
    if (toast === null) return;
    const id = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(id);
  }, [toast]);

  const mutation = useMutation(
    trpc.account.updateStalenessThresholds.mutationOptions({
      onSuccess: (_data, variables) => {
        setToast({
          kind: "success",
          text: STALENESS_THRESHOLD_SAVE_TOAST_PT_BR,
        });
        // R1-followup LOW-2 — sync local state from the submitted
        // values so `isDefault` flips to false for any newly-persisted
        // category and `touched` resets. Without this, the form's
        // `isDefault` hint kept showing even after a save because the
        // RSC re-fetch did not propagate into `useState`.
        const persistedByCategory = new Map(
          variables.thresholds.map((t) => [
            t.biomarkerCategory,
            t.thresholdDays,
          ]),
        );
        setRows((prev) =>
          prev.map((r) => {
            const persisted = persistedByCategory.get(r.biomarkerCategory);
            if (persisted === undefined) return { ...r, touched: false };
            return {
              ...r,
              value: String(persisted),
              isDefault: false,
              touched: false,
            };
          }),
        );
        // Invalidate the tRPC query so any sibling RSC / hook that
        // reads `listStalenessThresholds` re-fetches. `router.refresh()`
        // still triggers the RSC re-render below.
        void queryClient.invalidateQueries({
          queryKey: trpc.account.listStalenessThresholds.queryKey(),
        });
        router.refresh();
      },
      onError: () => {
        setToast({ kind: "error", text: STALENESS_THRESHOLD_SAVE_ERROR_PT_BR });
      },
    }),
  );

  function isRowInvalid(value: string): boolean {
    if (!/^\d+$/.test(value)) return true;
    const n = Number(value);
    return (
      !Number.isInteger(n) ||
      n < STALENESS_THRESHOLD_MIN_DAYS ||
      n > STALENESS_THRESHOLD_MAX_DAYS
    );
  }

  const anyInvalid = rows.some((r) => isRowInvalid(r.value));

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (anyInvalid) return;
    const thresholds = rows.map((r) => ({
      biomarkerCategory: r.biomarkerCategory,
      thresholdDays: Number(r.value),
    }));
    mutation.mutate({ thresholds });
  }

  return (
    <form onSubmit={onSubmit}>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {rows.map((row, idx) => {
          const invalid = isRowInvalid(row.value);
          return (
            <li
              key={row.biomarkerCategory}
              style={{
                display: "flex",
                gap: 12,
                alignItems: "center",
                padding: "12px 0",
                borderBottom: "1px solid #e5e7eb",
                flexWrap: "wrap",
              }}
            >
              <label
                htmlFor={`th-${row.biomarkerCategory}`}
                style={{ flex: "1 1 180px", fontSize: 14 }}
              >
                {row.labelPtBr}
              </label>
              <input
                id={`th-${row.biomarkerCategory}`}
                type="number"
                min={STALENESS_THRESHOLD_MIN_DAYS}
                max={STALENESS_THRESHOLD_MAX_DAYS}
                step={1}
                value={row.value}
                aria-invalid={invalid}
                aria-describedby={
                  invalid
                    ? `th-err-${row.biomarkerCategory}`
                    : row.isDefault && !row.touched
                      ? `th-hint-${row.biomarkerCategory}`
                      : undefined
                }
                onChange={(e) =>
                  setRows((prev) =>
                    prev.map((r, i) =>
                      i === idx
                        ? { ...r, value: e.target.value, touched: true }
                        : r,
                    ),
                  )
                }
                style={{
                  width: 90,
                  padding: "6px 8px",
                  border: invalid ? "1px solid #d97706" : "1px solid #d4d4d8",
                  borderRadius: 6,
                  fontSize: 14,
                }}
              />
              <span style={{ fontSize: 13, color: "#6b7280" }}>
                {STALENESS_THRESHOLD_DAYS_LABEL_PT_BR}
              </span>
              {invalid ? (
                <span
                  id={`th-err-${row.biomarkerCategory}`}
                  role="alert"
                  style={{
                    width: "100%",
                    fontSize: 12,
                    color: "#d97706",
                  }}
                >
                  {STALENESS_THRESHOLD_RANGE_ERROR_PT_BR}
                </span>
              ) : row.isDefault && !row.touched ? (
                <span
                  id={`th-hint-${row.biomarkerCategory}`}
                  style={{
                    width: "100%",
                    fontSize: 12,
                    color: "#6b7280",
                  }}
                >
                  {STALENESS_THRESHOLD_DEFAULT_HINT_PT_BR}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div
        style={{
          marginTop: 24,
          display: "flex",
          gap: 12,
          alignItems: "center",
        }}
      >
        <button
          type="submit"
          disabled={mutation.isPending || anyInvalid}
          style={{
            padding: "10px 16px",
            borderRadius: 8,
            border: "1px solid #1f2937",
            background: "#1f2937",
            color: "#fff",
            fontSize: 14,
            cursor:
              mutation.isPending || anyInvalid ? "not-allowed" : "pointer",
            opacity: mutation.isPending || anyInvalid ? 0.6 : 1,
          }}
        >
          {mutation.isPending
            ? STALENESS_THRESHOLD_SAVE_CTA_LOADING_PT_BR
            : STALENESS_THRESHOLD_SAVE_CTA_PT_BR}
        </button>
        {toast ? (
          <span
            role={toast.kind === "error" ? "alert" : "status"}
            style={{
              fontSize: 13,
              color: toast.kind === "error" ? "#d97706" : "#15803d",
            }}
          >
            {toast.text}
          </span>
        ) : null}
      </div>
    </form>
  );
}
