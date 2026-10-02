/** The table a location hash names, or none when the hash is not a valid escape */
export function tableNameOf(hash: string): string {
  try {
    return decodeURIComponent(hash.slice(1));
  } catch {
    return '';
  }
}
