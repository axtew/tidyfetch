import { FetchError, ofetch } from "ofetch";

let token = "initial";

const api = ofetch.create({
  baseURL: "https://api.example.com/v1",
  timeout: 10_000,
  onRequest({ options }) {
    options.headers.set("Authorization", `Bearer ${token}`);
  },
});

export function setToken(value) {
  token = value;
}

export async function run() {
  try {
    const user = await api("/me");
    return await api("/notes", { method: "POST", body: { text: "Hello", userId: user.id } });
  } catch (error) {
    if (error instanceof FetchError && error.status === 404) return null;
    throw error;
  }
}
