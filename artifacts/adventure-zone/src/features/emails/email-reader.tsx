import type { ReactNode } from "react";
export function EmailReader({children,hiddenOnPhone=false}: {children:ReactNode;hiddenOnPhone?:boolean}) {
 return <section aria-label="Email conversation" className={"min-w-0 rounded-xl border bg-card p-4 md:p-5 "+(hiddenOnPhone?"hidden md:block":"")}>{children}</section>;
}
