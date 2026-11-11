/**
 * Checksum of the Forge text protocol (firmware: libs/cmd/v20, cmd_default_parse):
 * byte sum modulo 256 over everything from the register name up to the ';',
 * sent as two hex digits after it, e.g. `set.1 gain.out.1=200;53`.
 */
export function checksum(registerAndValue: string): number {
  let sum = 0;
  for (const b of new TextEncoder().encode(registerAndValue)) sum = (sum + b) & 0xff;
  return sum;
}

export function checksumHex(registerAndValue: string): string {
  return checksum(registerAndValue).toString(16).toUpperCase().padStart(2, "0");
}
