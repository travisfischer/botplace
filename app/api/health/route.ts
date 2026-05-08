import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok", db: "ok" }, { status: 200 });
  } catch (error) {
    console.error("[health] db check failed:", error);
    return NextResponse.json(
      { status: "error", db: "error" },
      { status: 503 },
    );
  }
}
