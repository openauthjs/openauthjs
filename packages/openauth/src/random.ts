import { timingSafeEqual } from "node:crypto"

export function generateUnbiasedDigits(length: number): string {
  const result: number[] = []
  while (result.length < length) {
    const buffer = crypto.getRandomValues(new Uint8Array(length * 2))
    for (const byte of buffer) {
      if (byte < 250 && result.length < length) {
        result.push(byte % 10)
      }
    }
  }
  return result.join("")
}

export function timingSafeCompare(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") {
    return false
  }
  if (a.length !== b.length) {
    return false
  }
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}
