import { createClient, HttpError } from "tidyfetch";

let token = "initial";

const api = createClient({
  baseUrl: "https://api.example.com/v1",
  headers: () => ({ Authorization: `Bearer ${token}` }),
  timeout: 10_000,
});

export function setToken(value) {
  token = value;
}

export async function run() {
  try {
    const { data: user } = await api.get("/me");
    const { data: note } = await api.post("/notes", { body: { text: "Hello", userId: user.id } });
    return note;
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return null;
    throw error;
  }
}
