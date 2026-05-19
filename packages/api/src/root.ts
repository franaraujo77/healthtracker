import { accountRouter } from "./router/account";
import { authRouter } from "./router/auth";
import { postRouter } from "./router/post";
import { createTRPCRouter } from "./trpc";

export const appRouter = createTRPCRouter({
  account: accountRouter,
  auth: authRouter,
  post: postRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;
