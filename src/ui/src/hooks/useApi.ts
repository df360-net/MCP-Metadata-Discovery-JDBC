import { useState, useEffect, useCallback } from "react";

export function useFetch<T>(url: string, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(url, { signal });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error ?? res.statusText);
      }
      setData(await res.json());
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    const controller = new AbortController();
    refetch(controller.signal);
    return () => controller.abort();
  }, [refetch, ...deps]);

  return { data, loading, error, refetch };
}

async function parseJsonSafe(res: Response): Promise<Record<string, unknown>> {
  try {
    return await res.json();
  } catch {
    return { error: res.statusText };
  }
}

export async function apiPost<T = unknown>(url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  const json = await parseJsonSafe(res);
  if (!res.ok) throw new Error((json.error as string) ?? res.statusText);
  return json as T;
}

export async function apiPut<T = unknown>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const json = await parseJsonSafe(res);
  if (!res.ok) throw new Error((json.error as string) ?? res.statusText);
  return json as T;
}

export async function apiDelete(url: string, signal?: AbortSignal): Promise<void> {
  const res = await fetch(url, { method: "DELETE", signal });
  const json = await parseJsonSafe(res);
  if (!res.ok) throw new Error((json.error as string) ?? res.statusText);
}
