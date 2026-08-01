import { ContactForm } from "@/components/contacts/contact-form";
import { createContactAction } from "@/actions/contacts";

export default function ContactNewPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-8 text-3xl font-bold tracking-tight">Add contact</h1>
      <ContactForm onSubmit={createContactAction} successPath="/contacts" />
    </div>
  );
}
