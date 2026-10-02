import { z } from "zod";
export const safeOperationsHref = z
  .string()
  .max(2000)
  .refine((value) => {
    if (/[\\\u0000-\u0020]/.test(value)) return false;
    if (value.startsWith("/") && !value.startsWith("//")) return true;
    return (
      /^https:\/\/[^/@?#]+(?:[/?#]|$)/i.test(value) &&
      z.string().url().safeParse(value).success
    );
  }, "Use an internal app link or HTTPS source");
export const operationsSourceSchema = z.object({
  label: z.string(),
  href: safeOperationsHref,
});
