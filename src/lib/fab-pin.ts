// PIN hashing for the kiosk roster. bcrypt, 10 rounds.
import bcrypt from 'bcryptjs'

const ROUNDS = 10

export function isValidPinFormat(pin: string): boolean {
  return /^\d{4}$/.test(pin)
}

export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, ROUNDS)
}

export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  if (!pin || !hash) return false
  return bcrypt.compare(pin, hash)
}
