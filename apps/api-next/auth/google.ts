import { Google } from "arctic";

// Get environment variables (validate at runtime, not build time)
const clientId = process.env.GOOGLE_CLIENT_ID || "";
const clientSecret = process.env.GOOGLE_CLIENT_SECRET || "";
const redirectUri = process.env.GOOGLE_REDIRECT_URI || "";

// Helper to validate at runtime
export function validateGoogleConfig() {
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "Missing required Google OAuth environment variables: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI"
    );
  }
}

// Initialize Google OAuth client with Arctic
// Will use empty strings during build, but validateGoogleConfig() will be called at runtime
export const google = new Google(clientId, clientSecret, redirectUri);

// Google Calendar API scopes
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar.readonly",
];
