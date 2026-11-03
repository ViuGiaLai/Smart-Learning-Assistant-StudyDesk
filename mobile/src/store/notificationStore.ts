import { create } from "zustand";

import { ApiError, api } from "../api/client";
import type { NotificationItem } from "../api/types";

interface NotificationState {
  items: NotificationItem[];
  unreadCount: number;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  lastFetchedAt: number;

  load: (options?: { force?: boolean; background?: boolean }) => Promise<void>;
  markOneRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  setItems: (items: NotificationItem[]) => void;
  reset: () => void;
}

function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Không tải được thông báo";
}

const CACHE_TTL_MS = 20_000; // 20 seconds cache

export const useNotificationStore = create<NotificationState>((set, get) => ({
  items: [],
  unreadCount: 0,
  loading: false,
  refreshing: false,
  error: null,
  lastFetchedAt: 0,

  async load(options = {}) {
    const { force = false, background = false } = options;
    const now = Date.now();
    const state = get();

    // Cache hit: skip network if recently fetched and not forced
    if (!force && state.items.length > 0 && now - state.lastFetchedAt < CACHE_TTL_MS) {
      return;
    }

    if (background) {
      // Background revalidation: keep existing items, no visible spinner
    } else if (state.items.length === 0) {
      set({ loading: true, error: null });
    } else {
      set({ refreshing: true, error: null });
    }

    try {
      const result = await api.notifications(false, 50);
      const unread = result.filter((item) => !item.is_read).length;
      set({
        items: result,
        unreadCount: unread,
        loading: false,
        refreshing: false,
        lastFetchedAt: Date.now(),
        error: null,
      });
    } catch (error) {
      set({
        loading: false,
        refreshing: false,
        error: messageOf(error),
      });
    }
  },

  async markOneRead(id: string) {
    const current = get().items;
    const target = current.find((item) => item.id === id);
    if (!target || target.is_read) return;

    // Optimistic UI update: instantly mark as read
    const nextItems = current.map((item) =>
      item.id === id ? { ...item, is_read: true } : item,
    );
    const unread = nextItems.filter((item) => !item.is_read).length;
    set({ items: nextItems, unreadCount: unread });

    try {
      await api.markRead(id);
    } catch {
      // Revert if failed
      set({ items: current, unreadCount: current.filter((item) => !item.is_read).length });
    }
  },

  async markAllRead() {
    const current = get().items;
    const hasUnread = current.some((item) => !item.is_read);
    if (!hasUnread) return;

    // Optimistic UI update: instantly mark all as read
    const nextItems = current.map((item) => ({ ...item, is_read: true }));
    set({ items: nextItems, unreadCount: 0 });

    try {
      await api.markAllRead();
    } catch {
      // Revert if failed
      set({ items: current, unreadCount: current.filter((item) => !item.is_read).length });
    }
  },

  setItems(items: NotificationItem[]) {
    const unread = items.filter((item) => !item.is_read).length;
    set({ items, unreadCount: unread, lastFetchedAt: Date.now() });
  },

  reset() {
    set({
      items: [],
      unreadCount: 0,
      loading: false,
      refreshing: false,
      error: null,
      lastFetchedAt: 0,
    });
  },
}));
