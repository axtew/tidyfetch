import ky, { HTTPError } from "ky";

let token = "initial";

const api = ky.create({
  baseUrl: "https://api.example.com/v1/",
  timeout: 10_000,
  hooks: {
    beforeRequest: [
      ({ request }) => {
        request.headers.set("Authorization", `Bearer ${token}`);
      },
    ],
  },
});

export function setToken(value) {
  token = value;
}

export async function run() {
  try {
    const user = await api.get("me").json();
    return await api.post("notes", { json: { text: "Hello", userId: user.id } }).json();
  } catch (error) {
    if (error instanceof HTTPError && error.response.status === 404) return null;
    throw error;
  }
}
