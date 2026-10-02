// Talking to the API (/api/…). The save code is kept in this browser and sent with every call.
const KEY = "bc.save";
export const SAVE = /^[A-Za-z0-9_-]{8,32}\.[A-Za-z0-9_-]{20,64}$/;

export function getSave() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
export function setSave(code) { try { if (code) localStorage.setItem(KEY, code); else localStorage.removeItem(KEY); } catch (e) { /* private mode: this visit only */ } }

export async function call(method, path, body) {
  const headers = { "Content-Type": "application/json" };
  const save = getSave();
  if (save) headers.Authorization = "Bearer " + save;
  let r;
  try { r = await fetch("/api" + path, { method, headers, body: body ? JSON.stringify(body) : undefined }); }
  catch (e) { throw Object.assign(new Error("Can't reach the dog house right now."), { offline: true }); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error((data.error && data.error.message) || "Something went wrong."), { status: r.status, code: data.error && data.error.code });
  return data;
}
