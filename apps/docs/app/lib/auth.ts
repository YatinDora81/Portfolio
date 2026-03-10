import { SignJWT, jwtVerify } from "jose";
if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET environment variable is required");
const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);
export async function signToken(payload: { userId: string; email: string; role: string }) {
  return new SignJWT(payload).setProtectedHeader({ alg: "HS256" }).setExpirationTime("7d").sign(JWT_SECRET);
}
export async function verifyToken(token: string) {
  const { payload } = await jwtVerify(token, JWT_SECRET);
  return payload as { userId: string; email: string; role: string };
}
