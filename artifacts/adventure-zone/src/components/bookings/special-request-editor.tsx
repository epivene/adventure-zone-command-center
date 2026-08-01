"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import type { BookingSpecialRequest } from "@/features/packages/package-repository";
import type {
  AddSpecialRequestInput,
  DecideSpecialRequestInput,
} from "@/features/packages/package-input";

type ActionResult = { ok: true } | { ok: false; error: string };

function label(value: string) {
  return value.replaceAll("_", " ").replace(/^\w/, (letter) =>
    letter.toUpperCase()
  );
}

export function SpecialRequestEditor({
  bookingId,
  requests,
  addRequest,
  decideRequest,
}: {
  bookingId: string;
  requests: BookingSpecialRequest[];
  addRequest: (input: AddSpecialRequestInput) => Promise<ActionResult>;
  decideRequest: (input: DecideSpecialRequestInput) => Promise<ActionResult>;
}) {
  const [description, setDescription] = useState("");
  const [treatment, setTreatment] =
    useState<AddSpecialRequestInput["treatment"]>("add_to_count");
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  useEffect(() => {
    if (status) statusRef.current?.focus();
  }, [status]);

  function showError(message: string) {
    setError(message);
  }

  async function submitNew(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingKey) return;
    setPendingKey("new");
    setError("");
    setStatus("");
    try {
      const result = await addRequest({ bookingId, description, treatment });
      if (!result.ok) showError(result.error);
      else {
        setDescription("");
        // Data re-fetches on navigation; no client-side refresh needed.
      }
    } catch {
      showError("Could not add the special request. Please try again.");
    } finally {
      setPendingKey(null);
    }
  }

  async function decide(
    request: BookingSpecialRequest,
    decision: "approved" | "declined",
  ) {
    if (pendingKey) return;
    setPendingKey(request.id);
    setError("");
    setStatus("");
    try {
      const result = await decideRequest({
        specialRequestId: request.id,
        decision,
        reason: reasons[request.id] ?? "",
      });
      if (!result.ok) showError(result.error);
      else {
        setStatus(`${request.description} ${decision}.`);
        // Data re-fetches on navigation; no client-side refresh needed.
      }
    } catch {
      showError("Could not save the request decision. Please try again.");
    } finally {
      setPendingKey(null);
    }
  }

  return (
    <section
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7"
      id="special-requests"
    >
      <h2 className="text-xl font-bold">Special requests</h2>
      <p className="mt-1 text-sm text-slate-600">
        Approval changes request status; it never silently rewrites the saved physical total.
      </p>
      {error ? (
        <p className="mt-3" ref={errorRef} role="alert" tabIndex={-1}>
          {error}
        </p>
      ) : null}
      {status ? (
        <p
          className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800"
          ref={statusRef}
          role="status"
          tabIndex={-1}
        >
          {status}
        </p>
      ) : null}
      <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={submitNew}>
        <label className="grid gap-1.5 font-medium sm:col-span-2">
          Request description
          <input
            onChange={(event) => setDescription(event.target.value)}
            required
            value={description}
          />
        </label>
        <label className="grid gap-1.5 font-medium">
          Count treatment
          <select
            onChange={(event) =>
              setTreatment(event.target.value as typeof treatment)
            }
            value={treatment}
          >
            <option value="add_to_count">Add to count</option>
            <option value="replace_included">Replace included</option>
            <option value="note_only">Note only</option>
          </select>
        </label>
        <button className="button-primary self-end" disabled={pendingKey !== null} type="submit">
          Add special request
        </button>
      </form>
      {requests.length ? (
        <ul className="mt-5 grid gap-3">
          {requests.map((request) => (
            <li className="rounded-lg border border-slate-200 p-4" key={request.id}>
              <p className="font-semibold">{request.description}</p>
              <p className="mt-1 text-sm text-slate-600">
                {label(request.treatment)} · {label(request.approvalStatus)}
              </p>
              {request.decisionReason ? (
                <p className="mt-1 text-sm">Decision: {request.decisionReason}</p>
              ) : null}
              {request.approvalStatus === "needs_approval" ? (
                <div className="mt-3 grid gap-2">
                  <label className="grid gap-1.5 font-medium">
                    {`Decision reason for ${request.description}`}
                    <input
                      onChange={(event) =>
                        setReasons((current) => ({
                          ...current,
                          [request.id]: event.target.value,
                        }))
                      }
                      required
                      value={reasons[request.id] ?? ""}
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="button-primary"
                      disabled={pendingKey !== null || !(reasons[request.id] ?? "").trim()}
                      onClick={() => decide(request, "approved")}
                      type="button"
                    >
                      Approve {request.description}
                    </button>
                    <button
                      className="button-secondary"
                      disabled={pendingKey !== null || !(reasons[request.id] ?? "").trim()}
                      onClick={() => decide(request, "declined")}
                      type="button"
                    >
                      Decline {request.description}
                    </button>
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-slate-600">No special requests recorded.</p>
      )}
    </section>
  );
}
