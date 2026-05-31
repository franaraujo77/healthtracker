import { accountRouter } from "./router/account";
import { authRouter } from "./router/auth";
import { consentRouter } from "./router/consent";
import { emotionalCheckInsRouter } from "./router/emotional-checkins";
import { letterRouter } from "./router/letter";
import { lifeEventsRouter } from "./router/life-events";
import { notificationsRouter } from "./router/notifications";
import { observationsRouter } from "./router/observations";
import { sharingRouter } from "./router/sharing";
import { uploadsRouter } from "./router/uploads";
import { voiceMemosRouter } from "./router/voice-memos";
import { createTRPCRouter } from "./trpc";

export const appRouter = createTRPCRouter({
  account: accountRouter,
  auth: authRouter,
  consent: consentRouter,
  emotionalCheckIns: emotionalCheckInsRouter,
  letter: letterRouter,
  lifeEvents: lifeEventsRouter,
  notifications: notificationsRouter,
  observations: observationsRouter,
  sharing: sharingRouter,
  uploads: uploadsRouter,
  voiceMemos: voiceMemosRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;
