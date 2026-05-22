import { accountRouter } from "./router/account";
import { authRouter } from "./router/auth";
import { consentRouter } from "./router/consent";
import { notificationsRouter } from "./router/notifications";
import { postRouter } from "./router/post";
import { uploadsRouter } from "./router/uploads";
import { createTRPCRouter } from "./trpc";

export const appRouter = createTRPCRouter({
  account: accountRouter,
  auth: authRouter,
  consent: consentRouter,
  notifications: notificationsRouter,
  post: postRouter,
  uploads: uploadsRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;
