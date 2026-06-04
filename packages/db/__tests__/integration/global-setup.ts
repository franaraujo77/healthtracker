import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Vitest globalSetup for the integration suite.
 *
 * Auto-detects a non-Docker-Desktop container runtime — Rancher Desktop
 * (the team's local provider), colima, or OrbStack — and points
 * testcontainers at its socket so `pnpm test:integration` "just works"
 * without the developer exporting `DOCKER_HOST` by hand. This closes the
 * "Rancher/testcontainers incompatibility" that left the integration suite
 * un-runnable locally for several epics (Epic 6 retro action item).
 *
 * No-op when `DOCKER_HOST` is already set (Docker Desktop / CI) or when no
 * known alternate socket exists — so it never overrides an explicit setup.
 *
 * Ryuk (testcontainers' reaper container) is unreliable on these backends;
 * the per-suite `afterAll(container.stop())` already handles teardown, so
 * we disable it when we take over socket selection.
 */
export default function setup(): void {
  if (process.env.DOCKER_HOST) return;

  const candidates = [
    join(homedir(), ".rd/docker.sock"), // Rancher Desktop
    join(homedir(), ".colima/default/docker.sock"), // colima
    join(homedir(), ".orbstack/run/docker.sock"), // OrbStack
  ];
  const socket = candidates.find((p) => existsSync(p));
  if (!socket) return;

  process.env.DOCKER_HOST = `unix://${socket}`;
  process.env.TESTCONTAINERS_RYUK_DISABLED ??= "true";
}
