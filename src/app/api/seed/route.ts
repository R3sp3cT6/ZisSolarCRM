import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import bcrypt from "bcryptjs";

export async function GET() {
  // Simple seed endpoint - create admin user if none exists
  const passwordHash = await bcrypt.hash("admin123", 12);

  try {
    await db
      .insert(users)
      .values({
        name: "Admin",
        email: "admin@zissolar.mk",
        passwordHash,
        role: "admin",
      })
      .onConflictDoNothing();

    return NextResponse.json({
      success: true,
      message: "Admin user created. Email: admin@zissolar.mk, Password: admin123",
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to seed", detail: String(error) },
      { status: 500 }
    );
  }
}
