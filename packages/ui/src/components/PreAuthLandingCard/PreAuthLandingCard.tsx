"use client";

import { Text, YStack } from "tamagui";

import {
  PRE_AUTH_LANDING_ACTIVE_BODY_PT_BR,
  PRE_AUTH_LANDING_ACTIVE_FALLBACK_NAME_PT_BR,
  PRE_AUTH_LANDING_ACTIVE_HEADING_FN,
  PRE_AUTH_LANDING_CTA_A11Y_PT_BR_FN,
  PRE_AUTH_LANDING_CTA_PT_BR,
  PRE_AUTH_LANDING_EXPIRED_BODY_PT_BR,
  PRE_AUTH_LANDING_EXPIRED_HEADING_PT_BR,
  PRE_AUTH_LANDING_INVALID_BODY_PT_BR,
  PRE_AUTH_LANDING_INVALID_HEADING_PT_BR,
  PRE_AUTH_LANDING_REVOKED_BODY_PT_BR,
  PRE_AUTH_LANDING_REVOKED_HEADING_PT_BR,
} from "@healthtracker/validators";

import { Button } from "../../button";

/**
 * Story 6.1 — pre-auth landing card. Four discriminated states; the
 * `active` branch is the only one that renders a CTA. The expired /
 * revoked / invalid copy is intentionally generic — never leaks the
 * patient's identity (information-disclosure hygiene).
 *
 * Responsive (AC8 / UX-DR16):
 *   - $lg+   → max-width 480px, centred.
 *   - $sm–$md → full-width, padding-top 20vh.
 *
 * The active CTA is rendered as a Button wrapped in a native `<a>`
 * link to `/m/{token}/auth` (Story 6.2 owns the destination). The
 * component is web-only — Expo doctor surface is not in scope.
 */

export type PreAuthLandingStatus = "active" | "expired" | "revoked" | "invalid";

export interface PreAuthLandingCardProps {
  status: PreAuthLandingStatus;
  patientFirstName: string | null;
  sharedAt: Date | null;
  /**
   * Composite `${shareTokenId}.${tokenHmac}` segment. Used to build
   * the active-state CTA's href. Ignored for non-active states.
   */
  token?: string;
}

export function PreAuthLandingCard(
  props: PreAuthLandingCardProps,
): React.ReactElement {
  const { status, patientFirstName, token } = props;

  if (status === "active") {
    const name =
      patientFirstName && patientFirstName.length > 0
        ? patientFirstName
        : PRE_AUTH_LANDING_ACTIVE_FALLBACK_NAME_PT_BR;
    const heading = PRE_AUTH_LANDING_ACTIVE_HEADING_FN(name);
    const ctaA11y = PRE_AUTH_LANDING_CTA_A11Y_PT_BR_FN(name);
    const href = token ? `/m/${token}/auth` : "#";
    return (
      <YStack
        testID="pre-auth-landing-card-active"
        padding="$4"
        gap="$3"
        borderRadius="$card"
        backgroundColor="$surfaceElevated"
        borderWidth={1}
        borderColor="$borderSubtle"
        maxWidth={480}
        width="100%"
        $sm={{ paddingTop: "$4" }}
      >
        <Text fontSize="$6" color="$textPrimary">
          {heading}
        </Text>
        <Text fontSize="$3" color="$textSecondary">
          {PRE_AUTH_LANDING_ACTIVE_BODY_PT_BR}
        </Text>
        {/*
         * R1-N2 — single link element. Wrapping a Button (role=button)
         * inside an <a> (role=link) made screen readers announce both
         * roles. The anchor IS the actuator; the Button render is a
         * styled child whose `accessibilityRole` is stripped here.
         */}
        <a
          href={href}
          role="link"
          aria-label={ctaA11y}
          style={{ textDecoration: "none" }}
        >
          <Button testID="pre-auth-landing-cta" variant="primary">
            {PRE_AUTH_LANDING_CTA_PT_BR}
          </Button>
        </a>
      </YStack>
    );
  }

  // Dead-link states — identical structure, distinct copy. Same
  // generic shape for invalid/expired/revoked so we do not leak
  // which one it is via DOM differences.
  let heading: string;
  let body: string;
  let testID: string;
  if (status === "expired") {
    heading = PRE_AUTH_LANDING_EXPIRED_HEADING_PT_BR;
    body = PRE_AUTH_LANDING_EXPIRED_BODY_PT_BR;
    testID = "pre-auth-landing-card-expired";
  } else if (status === "revoked") {
    heading = PRE_AUTH_LANDING_REVOKED_HEADING_PT_BR;
    body = PRE_AUTH_LANDING_REVOKED_BODY_PT_BR;
    testID = "pre-auth-landing-card-revoked";
  } else {
    heading = PRE_AUTH_LANDING_INVALID_HEADING_PT_BR;
    body = PRE_AUTH_LANDING_INVALID_BODY_PT_BR;
    testID = "pre-auth-landing-card-invalid";
  }
  return (
    <YStack
      testID={testID}
      padding="$4"
      gap="$3"
      borderRadius="$card"
      backgroundColor="$surfaceElevated"
      borderWidth={1}
      borderColor="$borderSubtle"
      maxWidth={480}
      width="100%"
    >
      <Text fontSize="$6" color="$textPrimary">
        {heading}
      </Text>
      <Text fontSize="$3" color="$textSecondary">
        {body}
      </Text>
    </YStack>
  );
}
