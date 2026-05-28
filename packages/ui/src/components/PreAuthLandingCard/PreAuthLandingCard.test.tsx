/**
 * Story 6.1 T5.4 / AC11 — snapshot + a11y scaffold for
 * `PreAuthLandingCard`. Authored as a runner-ready spec; the `ui`
 * package does not wire a test runner today (same posture as
 * `DeleteAccountConfirmationCard.test.tsx`).
 */
// @ts-nocheck — runs only when the ui package wires a test runner.
import { render } from "@testing-library/react-native";
import { describe, expect, it } from "vitest";

import {
  PRE_AUTH_LANDING_ACTIVE_FALLBACK_NAME_PT_BR,
  PRE_AUTH_LANDING_CTA_A11Y_PT_BR_FN,
  PRE_AUTH_LANDING_CTA_PT_BR,
} from "@healthtracker/validators";

import { PreAuthLandingCard } from "./PreAuthLandingCard";

describe("PreAuthLandingCard — Story 6.1 AC5/AC11", () => {
  it("renders active state with patient first name", () => {
    const tree = render(
      <PreAuthLandingCard
        status="active"
        patientFirstName="Francis"
        sharedAt={new Date("2026-05-28T00:00:00Z")}
        token="abc.def"
      />,
    );
    expect(tree.getByTestId("pre-auth-landing-card-active")).toBeTruthy();
    expect(tree.queryByText(PRE_AUTH_LANDING_CTA_PT_BR)).toBeTruthy();
  });

  it("falls back to 'Alguém' when patientFirstName is null", () => {
    const tree = render(
      <PreAuthLandingCard
        status="active"
        patientFirstName={null}
        sharedAt={new Date()}
        token="abc.def"
      />,
    );
    // The fallback string is rendered in the heading.
    expect(
      tree.queryByText(new RegExp(PRE_AUTH_LANDING_ACTIVE_FALLBACK_NAME_PT_BR)),
    ).toBeTruthy();
  });

  it("renders expired state with no CTA", () => {
    const tree = render(
      <PreAuthLandingCard
        status="expired"
        patientFirstName={null}
        sharedAt={null}
      />,
    );
    expect(tree.getByTestId("pre-auth-landing-card-expired")).toBeTruthy();
    expect(tree.queryByText(PRE_AUTH_LANDING_CTA_PT_BR)).toBeFalsy();
  });

  it("renders revoked state with no CTA", () => {
    const tree = render(
      <PreAuthLandingCard
        status="revoked"
        patientFirstName={null}
        sharedAt={null}
      />,
    );
    expect(tree.getByTestId("pre-auth-landing-card-revoked")).toBeTruthy();
    expect(tree.queryByText(PRE_AUTH_LANDING_CTA_PT_BR)).toBeFalsy();
  });

  it("renders invalid state with no CTA", () => {
    const tree = render(
      <PreAuthLandingCard
        status="invalid"
        patientFirstName={null}
        sharedAt={null}
      />,
    );
    expect(tree.getByTestId("pre-auth-landing-card-invalid")).toBeTruthy();
    expect(tree.queryByText(PRE_AUTH_LANDING_CTA_PT_BR)).toBeFalsy();
  });

  it("active CTA carries the per-patient accessibilityLabel", () => {
    const tree = render(
      <PreAuthLandingCard
        status="active"
        patientFirstName="Francis"
        sharedAt={new Date()}
        token="abc.def"
      />,
    );
    const cta = tree.getByTestId("pre-auth-landing-cta");
    // The label is on the wrapping anchor and on the Button. Either is sufficient for SR.
    expect(cta.props.accessibilityLabel).toBe(
      PRE_AUTH_LANDING_CTA_A11Y_PT_BR_FN("Francis"),
    );
  });
});
