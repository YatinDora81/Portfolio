import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";

export async function middleware(request: NextRequest) {
  const token = request.cookies.get("admin_session")?.value;
  const authPages = ["/login", "/forgot-password", "/reset-password"];
  const isAuthPage = authPages.includes(request.nextUrl.pathname);

  if (!token && !isAuthPage) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (token) {
    try {
      await verifyToken(token);
      if (isAuthPage) {
        return NextResponse.redirect(new URL("/dashboard", request.url));
      }
    } catch {
      const response = NextResponse.redirect(new URL("/login", request.url));
      response.cookies.delete("admin_session");
      return response;
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.svg$).*)"],
};
