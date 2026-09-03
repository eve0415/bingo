/** Wrangler types every binding as a string, but a secret that was never set is simply absent at runtime. */
export const configured = (value: string | undefined): string | null => (value === undefined || value.length === 0 ? null : value);
