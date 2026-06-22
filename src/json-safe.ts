export function toJsonSafe<T>(value: T): T {
  const serialized = JSON.stringify(value)
  return (serialized === undefined ? null : JSON.parse(serialized)) as T
}
