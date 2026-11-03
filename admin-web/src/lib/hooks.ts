"use client";

import { useCallback, useEffect, useState } from "react";

import { apiGet, ApiError } from "@/lib/api";

interface ApiState<T> {
  path: string | null;
  data: T | null;
  loading: boolean;
  error: string | null;
}

export function useApi<T>(path: string | null) {
  const [state, setState] = useState<ApiState<T>>({
    path: null,
    data: null,
    loading: false,
    error: null,
  });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!path) return;
    let active = true;
    apiGet<T>(path)
      .then((data) => {
        if (active) setState({ path, data, loading: false, error: null });
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof ApiError && error.status === 401) return;
        setState({
          path,
          data: null,
          loading: false,
          error:
            error instanceof Error ? error.message : "Không tải được dữ liệu",
        });
      });
    return () => {
      active = false;
    };
  }, [path, version]);

  const reload = useCallback(() => {
    setState((current) => ({ ...current, loading: true }));
    setVersion((value) => value + 1);
  }, []);

  const setData = useCallback(
    (data: T | null) =>
      setState((current) => ({ ...current, data, path: current.path })),
    [],
  );

  const stale = state.path !== path;
  return {
    data: stale ? null : state.data,
    loading: path ? stale || state.loading : false,
    error: stale ? null : state.error,
    reload,
    setData,
  };
}

export function useDebounced<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
