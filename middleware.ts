import { auth } from "@/lib/auth";

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const isOnLogin = req.nextUrl.pathname === "/login";
  const isApi = req.nextUrl.pathname.startsWith("/api");

  // Allow API routes (they handle their own auth)
  if (isApi) return;

  // Redirect to login if not authenticated
  if (!isLoggedIn && !isOnLogin) {
    return Response.redirect(new URL("/login", req.nextUrl));
  }

  // Redirect to dashboard if already logged in and on login page
  if (isLoggedIn && isOnLogin) {
    return Response.redirect(new URL("/dashboard", req.nextUrl));
  }
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|zis-logo.png).*)",
  ],
};
