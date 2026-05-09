// Auth.js v5 entry point. Lives at the project root per Auth.js convention —
// imported by `app/api/auth/[...nextauth]/route.ts`, by `src/auth/session.ts`,
// and (in future) by `middleware.ts`.

import NextAuth from "next-auth";
import type {} from "next-auth/jwt";
import Google from "next-auth/providers/google";

import { prisma } from "@/lib/prisma";

declare module "next-auth" {
  interface Session {
    /** Botplace `Owner.id` (cuid). Set by the JWT callback on sign-in. */
    ownerId?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    ownerId?: string;
  }
}

/** Coerce a profile field to a non-empty string, or null. */
function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  // JWT-only sessions: no Session table, no per-request DB lookup. Sessions
  // are signed against AUTH_SECRET. Server-side revocation isn't a feature
  // M1 needs; M4 ops hardening can revisit if it becomes load-bearing.
  session: { strategy: "jwt" },
  callbacks: {
    async signIn({ profile }) {
      // Reject sign-ins where Google didn't verify the email.
      return profile?.email_verified === true;
    },
    async jwt({ token, account, profile }) {
      // `account` and `profile` are only present on the initial sign-in
      // response from the provider. On subsequent requests this callback
      // fires too, but with neither set — so the upsert only runs once.
      if (account?.provider === "google" && profile?.sub) {
        const email = asNonEmptyString(profile.email);
        if (!email) return token;
        const name = asNonEmptyString(profile.name) ?? email;
        const owner = await prisma.owner.upsert({
          where: { googleSub: profile.sub },
          create: {
            googleSub: profile.sub,
            email,
            displayName: name,
          },
          update: {
            email,
            displayName: name,
          },
        });
        token.ownerId = owner.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.ownerId) {
        session.ownerId = token.ownerId;
      }
      return session;
    },
  },
});
