/**
 * Luhn checksum. Input must be digits only.
 * Method: from the right, double every second digit (subtract 9 when the
 * result is above 9), add everything up, and require the total to be a
 * multiple of 10.
 */
export function luhnValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}
