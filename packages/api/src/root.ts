import { accountRouter } from "./router/account";
import { authRouter } from "./router/auth";
import { consentRouter } from "./router/consent";
import { letterRouter } from "./router/letter";
import { notificationsRouter } from "./router/notifications";
import { observationsRouter } from "./router/observations";
import { sharingRouter } from "./router/sharing";
import { uploadsRouter } from "./router/uploads";
import { createTRPCRouter } from "./trpc";

export const appRouter = createTRPCRouter({
  account: accountRouter,
  auth: authRouter,
  consent: consentRouter,
  letter: letterRouter,
  notifications: notificationsRouter,
  observations: observationsRouter,
  sharing: sharingRouter,
  uploads: uploadsRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;
