/**
 * Story 9.2 — fail-loud boot gate for the production AWS Textract path.
 *
 * Pure + unit-testable (no SDK client, no network, no `process.exit`): it
 * inspects the environment and THROWS on misconfig, so a bad
 * `EXTRACTION_ADAPTER=aws` deploy crashes at worker boot — mirroring the
 * `SUPABASE_SERVICE_ROLE_KEY` NFR-S6 gate in `index.ts` — instead of
 * silently dead-lettering every upload at first dispatch.
 *
 * Altitude: this checks credential **presence**, not **validity**. It does
 * NOT make a live STS/Textract call — NFR-S8 forbids live AWS in CI, and a
 * boot-time network call would couple worker startup to AWS reachability.
 * "Configured but invalid/expired" creds surface at first dispatch (where
 * Story 9.3 dead-letters cleanly). Credential sources WITHOUT an env
 * footprint — `AWS_PROFILE`/shared-config (`~/.aws`), SSO, EC2-IMDS — are
 * intentionally NOT accepted: our deploy target (Railway) injects static
 * keys, so a missing env-based source is a real misconfig worth crashing on.
 */

/** Data-residency region for patient documents (NFR-S8 / LGPD). */
export const AWS_TEXTRACT_REGION = "sa-east-1";

/**
 * Validate the AWS Textract runtime config. Returns the pinned region on
 * success; throws a clear deploy-config `Error` on misconfig. Call at boot
 * inside the `EXTRACTION_ADAPTER === "aws"` branch.
 */
export function assertAwsTextractConfig(env: NodeJS.ProcessEnv = process.env): {
  region: string;
} {
  // Region pin (NFR-S8). Unset OR blank (an empty/whitespace env var — the
  // common Railway/Docker "declared but not set" shape) defaults to
  // sa-east-1; any other concrete value fails. `||` (not `??`) + trim so
  // `AWS_REGION=""` falls back rather than spuriously crashing boot.
  const region = (env.AWS_REGION ?? "").trim() || AWS_TEXTRACT_REGION;
  if (region !== AWS_TEXTRACT_REGION) {
    throw new Error(
      `[aws-textract] AWS_REGION must be '${AWS_TEXTRACT_REGION}' for patient-data residency ` +
        `(NFR-S8); got '${region}'. Refusing to boot EXTRACTION_ADAPTER=aws outside the region.`,
    );
  }

  // Credential presence (NFR-S6 fail-loud). Accept static keys, a container
  // task role, or web-identity — any recognised source is sufficient. Each
  // source requires its FULL set so a half-configured source (which the SDK
  // could not resolve at dispatch) fails loud at boot, not silently later:
  //   - static:        both AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY
  //   - web-identity:  both AWS_WEB_IDENTITY_TOKEN_FILE + AWS_ROLE_ARN
  //     (the SDK's fromTokenFile AssumeRoleWithWebIdentity needs the role ARN)
  // NOTE: AWS_PROFILE / shared-config (~/.aws) / SSO / EC2-IMDS are valid SDK
  // credential sources we deliberately do NOT accept — this worker's deploy
  // target (Railway) injects static keys. Running it elsewhere needs one of
  // the env-based sources above.
  const hasStatic = !!(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY);
  const hasContainerRole = !!(
    env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI ??
    env.AWS_CONTAINER_CREDENTIALS_FULL_URI
  );
  const hasWebIdentity = !!(
    env.AWS_WEB_IDENTITY_TOKEN_FILE && env.AWS_ROLE_ARN
  );
  if (!hasStatic && !hasContainerRole && !hasWebIdentity) {
    throw new Error(
      "[aws-textract] No resolvable AWS credentials for EXTRACTION_ADAPTER=aws. " +
        "Set AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY (from the signed-DPA AWS account, " +
        "LGPD Art. 33), or a container/web-identity task role. " +
        "AWS_PROFILE/SSO/EC2-IMDS sources are intentionally not accepted. Refusing to boot.",
    );
  }

  return { region };
}
