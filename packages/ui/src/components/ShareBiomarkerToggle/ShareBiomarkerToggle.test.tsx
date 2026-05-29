/**
 * Story 5.1 T7.6 — ShareBiomarkerToggle component snapshot test.
 *
 * `packages/ui` doesn't currently wire a test runner (no Vitest /
 * Jest under the package — see `packages/ui/package.json`). This
 * file is authored as a runner-ready spec for the day the test
 * harness lands; the surrounding `tsconfig.json` excludes
 * `*.test.tsx` from typecheck so this doesn't gate CI today.
 *
 * Covered states (from `ShareBiomarkerToggle.tsx`):
 *   - shared  (visible=true)
 *   - hidden  (visible=false)
 *   - disabled (no data yet)
 */
// @ts-nocheck — runs only when the ui package wires a test runner.
import { render } from "@testing-library/react-native";
import { describe, expect, it } from "vitest";

import { ShareBiomarkerToggle } from "./ShareBiomarkerToggle";

describe("ShareBiomarkerToggle — visual snapshots (T7.6)", () => {
  it("renders the shared state (visible=true)", () => {
    const tree = render(
      <ShareBiomarkerToggle
        biomarkerCategory="ferritin"
        biomarkerLabel="Ferritina"
        visible={true}
        doctorName="Dra. Renata"
        onToggle={() => undefined}
      />,
    ).toJSON();
    expect(tree).toMatchSnapshot();
  });

  it("renders the hidden state (visible=false)", () => {
    const tree = render(
      <ShareBiomarkerToggle
        biomarkerCategory="ferritin"
        biomarkerLabel="Ferritina"
        visible={false}
        doctorName="Dra. Renata"
        onToggle={() => undefined}
      />,
    ).toJSON();
    expect(tree).toMatchSnapshot();
  });

  it("renders the disabled state (no data yet)", () => {
    const tree = render(
      <ShareBiomarkerToggle
        biomarkerCategory="ferritin"
        biomarkerLabel="Ferritina"
        visible={false}
        doctorName="Dra. Renata"
        disabled
        onToggle={() => undefined}
      />,
    ).toJSON();
    expect(tree).toMatchSnapshot();
  });
});
