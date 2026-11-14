import axios, { isAxiosError } from "axios";

let token = "initial";

const api = axios.create({
  baseURL: "https://api.example.com/v1",
  timeout: 10_000,
});

api.interceptors.request.use((config) => {
  config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export function setToken(value) {
  token = value;
}

export async function run() {
  try {
    const { data: user } = await api.get("/me");
    const { data: note } = await api.post("/notes", { text: "Hello", userId: user.id });
    return note;
  } catch (error) {
    if (isAxiosError(error) && error.response?.status === 404) return null;
    throw error;
  }
}
