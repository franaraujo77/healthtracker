import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("home page has no WCAG 2.1 AA violations", async ({ page }) => {
  await page.goto("/");
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});
