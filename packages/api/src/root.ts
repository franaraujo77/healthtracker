import { accountRouter } from "./router/account";
import { authRouter } from "./router/auth";
import { consentRouter } from "./router/consent";
import { notificationsRouter } from "./router/notifications";
import { observationsRouter } from "./router/observations";
import { uploadsRouter } from "./router/uploads";
import { createTRPCRouter } from "./trpc";

export const appRouter = createTRPCRouter({
  account: accountRouter,
  auth: authRouter,
  consent: consentRouter,
  notifications: notificationsRouter,
  observations: observationsRouter,
  uploads: uploadsRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;
