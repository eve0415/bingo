/** Every refusal this worker sends names itself, and the shape is declared once as `failureSchema` for the page that reads it. */
export const failure = (code: string, status: number, detail?: string): Response =>
  Response.json(
    {
      error: code,
      detail,
    },
    {
      status,
    },
  );
