import wretch from "wretch";
import AbortAddon from "wretch/addons/abort";

let token = "initial";

const api = wretch("https://api.example.com/v1").addon(AbortAddon());

export function setToken(value) {
  token = value;
}

export async function run() {
  const authed = api.auth(`Bearer ${token}`);
  const user = await authed
    .get("/me")
    .setTimeout(10_000)
    .notFound(() => null)
    .json();
  if (user === null) return null;
  return authed
    .post({ text: "Hello", userId: user.id }, "/notes")
    .setTimeout(10_000)
    .notFound(() => null)
    .json();
}
