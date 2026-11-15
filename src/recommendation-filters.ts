/** Fluid loops with the same two underlying tokens on each side are excluded from recommendations. */
export function sameTwoAssetBasket(supplied: readonly string[], borrowed: readonly string[]): boolean {
  const supply = new Set(supplied.filter(Boolean).map(address => address.toLowerCase()));
  const debt = new Set(borrowed.filter(Boolean).map(address => address.toLowerCase()));
  return supply.size === 2 && debt.size === 2 && [...supply].every(address => debt.has(address));
}
