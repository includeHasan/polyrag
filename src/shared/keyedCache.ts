interface KeyedCacheOptions {
  maxSize?: number
}

export interface KeyedCache<T> {
  get(key: string, build: () => T): T
  has(key: string): boolean
  clear(): void
  size(): number
}

export function createKeyedCache<T>(opts?: KeyedCacheOptions): KeyedCache<T> {
  const maxSize = opts?.maxSize ?? 100
  const map = new Map<string, T>()
  return {
    get(key: string, build: () => T): T {
      if (map.has(key)) {
        const val = map.get(key)!
        map.delete(key)
        map.set(key, val)
        return val
      }
      if (map.size >= maxSize) {
        const firstKey = map.keys().next().value
        if (firstKey !== undefined) map.delete(firstKey)
      }
      const val = build()
      map.set(key, val)
      return val
    },
    has(key: string): boolean { return map.has(key) },
    clear(): void { map.clear() },
    size(): number { return map.size },
  }
}
