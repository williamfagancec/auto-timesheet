# Clear Corrupted Session - Fix Blank Page Issue

## The Problem
You have a corrupted session cookie (likely with a malformed Google OAuth refresh token) that's causing the app to redirect or crash.

## Solution: Clear Browser Cookies

### Option 1: Clear Cookies via Browser DevTools (Recommended)

1. **Open the app** at http://localhost:3000
2. **Open DevTools**: Press `F12` (or `Cmd+Option+I` on Mac)
3. **Go to Application tab** (Chrome/Edge) or **Storage tab** (Firefox)
4. **Expand "Cookies"** in the left sidebar
5. **Click on "http://localhost:3000"**
6. **Delete all cookies** (right-click → Clear or click the 🗑️ icon)
7. **Click on "http://localhost:3001"** (if it exists)
8. **Delete all cookies**
9. **Hard refresh**: Press `Ctrl+Shift+R` (Windows/Linux) or `Cmd+Shift+R` (Mac)

### Option 2: Clear Cookies via Browser Settings

**Chrome:**
1. Go to `chrome://settings/cookies`
2. Click "See all cookies and site data"
3. Search for "localhost"
4. Click 🗑️ to remove all localhost cookies
5. Go back to http://localhost:3000 and refresh

**Firefox:**
1. Go to `about:preferences#privacy`
2. Click "Manage Data..." under Cookies and Site Data
3. Search for "localhost"
4. Click "Remove All Shown"
5. Go back to http://localhost:3000 and refresh

**Safari:**
1. Go to Safari → Preferences → Privacy
2. Click "Manage Website Data..."
3. Search for "localhost"
4. Click "Remove" for all localhost entries
5. Go back to http://localhost:3000 and refresh

### Option 3: Use Incognito/Private Window

1. **Open a new Incognito/Private window**
   - Chrome/Edge: `Ctrl+Shift+N` (Windows) or `Cmd+Shift+N` (Mac)
   - Firefox: `Ctrl+Shift+P` (Windows) or `Cmd+Shift+P` (Mac)
   - Safari: `Cmd+Shift+N` (Mac)
2. **Navigate to** http://localhost:3000
3. You should see the login page

## Expected Result

After clearing cookies, you should see:
- ✅ Login page with TimeSync logo
- ✅ Gradient sandy/orange background
- ✅ "Welcome Back" heading
- ✅ Email and password form fields
- ✅ "Sign in with Google" button

## If Still Having Issues

If the page is still blank after clearing cookies, please:

1. **Check browser console** (F12 → Console tab)
2. **Share any red error messages** you see
3. **Check Network tab** (F12 → Network tab → reload page)
4. Look for any failed requests (they'll be red)

The error mentioned in the logs suggests you had logged in previously with Google OAuth, and the refresh token got corrupted. Clearing cookies will force a fresh login.
