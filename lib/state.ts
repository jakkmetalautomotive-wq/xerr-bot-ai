// ความจำถาวรของบอท (จำได้แม้ Vercel เปิดเครื่องใหม่) — Upstash Redis ผ่าน REST
// Vercel › Storage › Upstash Redis › Connect → ได้ KV_REST_API_URL + KV_REST_API_TOKEN (หรือ UPSTASH_REDIS_REST_URL/TOKEN)
// ยังไม่ตั้ง / Redis ล่ม → ใช้หน่วยความจำชั่วคราว (ลืมได้เมื่อเครื่องเปลี่ยน แต่บอทยังทำงานต่อ)

export interface StateStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

export function memoryStore(now = () => Date.now()): StateStore & { clear(): void } {
  const data = new Map<string, { value: string; until: number }>();
  return {
    clear: () => data.clear(),
    async get(key) {
      const v = data.get(key);
      if (!v) return null;
      if (v.until <= now()) {
        data.delete(key);
        return null;
      }
      return v.value;
    },
    async set(key, value, ttlSeconds) {
      data.set(key, { value, until: now() + ttlSeconds * 1000 });
      if (data.size > 20_000) data.delete(data.keys().next().value!);
    },
  };
}

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export function redisStore(url: string, token: string, fallback: StateStore, fetchFn: FetchFn = fetch as FetchFn): StateStore {
  const command = async (args: (string | number)[]) => {
    const res = await fetchFn(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(3_000),
    });
    const data = (await res.json()) as { result?: unknown; error?: string };
    if (!res.ok || data.error) throw new Error(data.error ?? `status ${res.status}`);
    return data.result;
  };
  return {
    async get(key) {
      try {
        const r = await command(["GET", key]);
        return r == null ? null : String(r);
      } catch (err) {
        console.warn("[state] อ่าน Redis ไม่ได้ ใช้หน่วยความจำชั่วคราวแทน:", (err as Error).message);
        return fallback.get(key);
      }
    },
    async set(key, value, ttlSeconds) {
      await fallback.set(key, value, ttlSeconds); // เก็บสำรองในเครื่องด้วย เผื่อ Redis ล่มรอบถัดไป
      try {
        await command(["SET", key, value, "EX", Math.max(1, Math.round(ttlSeconds))]);
      } catch (err) {
        console.warn("[state] เขียน Redis ไม่ได้:", (err as Error).message);
      }
    },
  };
}

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
export const hasPersistentState = Boolean(REDIS_URL && REDIS_TOKEN);
const localMemory = memoryStore();
export const defaultState: StateStore = hasPersistentState ? redisStore(REDIS_URL, REDIS_TOKEN, localMemory) : localMemory;
export const _resetLocalState = () => localMemory.clear(); // ใช้ในเทสต์
