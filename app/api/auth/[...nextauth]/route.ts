// Auth.js v5 catch-all route. Destructures the GET / POST handlers built by
// `auth.ts` so Next.js's App Router routes `/api/auth/*` (sign-in, callback,
// session, sign-out, etc.) into Auth.js.

import { handlers } from "@/auth";

export const { GET, POST } = handlers;
