import { Google } from "arctic";

// Get environment variables (validate at runtime, not build time)
const clientId = process.env.GOOGLE_CLIENT_ID || "";
const clientSecret = process.env.GOOGLE_CLIENT_SECRET || "";
const redirectUri = process.env.GOOGLE_REDIRECT_URI || "";

let _google: Google | null = null;

//Lazy initiasation with validation
export function getGoogleClient(): Google {
  if (!_google) {
    if (!clientId || !clientSecret || !redirectUri) {
      throw new Error(
        "Missing required Google OAuth environment variables: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI"
      );
    }
    _google = new Google(clientId, clientSecret, redirectUri);
  }
  return _google;
}

// Google Calendar API scopes
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar.readonly",
];
