"use client";

import { Columns3, HandCoins, KeyRound, NotebookPen, Plus, UserPlus } from "lucide-react";
import { startTransition, useActionState, useRef, useState } from "react";
import { toast } from "sonner";
import {
  addAdvance,
  addBill,
  addBiller,
  addBillerField,
  addDrawerEntry,
  addHelperEntry,
  addMember,
  addPayment,
  addSharedColumn,
  setBillerSecret,
  submitPayment,
  updateAdvance,
  updateDrawerEntry,
  updateHelperEntry,
  updatePayment,
  type ActionState,
} from "@/app/periods/[year]/[month]/actions";
import { partyName } from "@/components/member-pair";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useIsPreviewing, useViewer } from "@/components/viewer-context";
import { DRAWER_KIND_LABELS, type DrawerKind } from "@/lib/cash-drawer";
import type { DrawerLine } from "@/lib/cash-drawer-data";
import { CATEGORY_LABELS, todayInManila } from "@/lib/format";
import { visitCashHint } from "@/lib/helper";
import { HOUSE_BUDGET_LABEL } from "@/lib/household-config";
import { formatPHP, fromCentavos, parseMoneyInput, type Centavos } from "@/lib/money";
import { isAdmin } from "@/lib/permissions";
import type { PeriodView, ViewAdvance, ViewHelperEntry, ViewPayment } from "@/lib/periods";
import { prepareReceiptFile } from "@/lib/receipt-image";
import { MAX_RECEIPT_BYTES } from "@/lib/receipts";
import { HOUSE_BUDGET, type Party } from "@/lib/settlement";

interface Props {
  view: PeriodView;
}

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * Runs a dialog form's Server Action. The forms live inside DialogContent, which unmounts on
 * close, so every open starts without an old error.
 *
 * Submits through onSubmit instead of <form action>: React resets a form after every
 * `action` — even one that returned an error — which would wipe everything typed so far
 * because of one mistyped amount.
 *
 * `saved` is the toast once it's saved ("Advance logged"), since the dialog just closes; null for
 * none (it stays open and says so itself). `prepare` runs first, in the browser (e.g. shrinking
 * a screenshot); it returns the form data to send, or an error to show instead of sending.
 */
function useDialogForm(
  action: Action,
  onSuccess: (formData: FormData) => void,
  {
    saved,
    prepare,
  }: {
    saved: string | ((formData: FormData) => string | null);
    prepare?: (formData: FormData) => Promise<FormData | { error: string }>;
  },
) {
  const [state, dispatch, pending] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await action(prev, formData);
    if (result?.ok) {
      onSuccess(formData);
      const message = typeof saved === "string" ? saved : saved(formData);
      if (message) toast.success(message);
    }
    return result;
  }, null);
  const [preparing, setPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  // While PA previews as a housemate the form can be looked at, not sent.
  const previewing = useIsPreviewing();
  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (previewing || preparing) return;
    const formData = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
    let ready: FormData | { error: string } = formData;
    if (prepare) {
      setPrepareError(null);
      setPreparing(true);
      try {
        ready = await prepare(formData);
      } finally {
        setPreparing(false);
      }
    }
    if (!(ready instanceof FormData)) return setPrepareError(ready.error);
    startTransition(() => dispatch(ready));
  };
  const shown: ActionState = prepareError ? { ok: false, error: prepareError } : state;
  return { state: shown, pending: pending || preparing, previewing, onSubmit };
}

export function AddAdvanceDialog({ view, className }: Props & { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className={className} />}>
        <Plus />
        Log new advance
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <AdvanceForm view={view} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

/** Edits an existing advance (open while `advance` is set). Changing the column moves it. */
export function EditAdvanceDialog({
  view,
  advance,
  onClose,
}: Props & { advance: ViewAdvance | null; onClose: () => void }) {
  return (
    <Dialog open={advance !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        {advance && <AdvanceForm key={advance.id} view={view} advance={advance} onDone={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Log a new advance, or edit one when `advance` is given. When adding, "Save & add another"
 * keeps the dialog open with the same payer, category, date and column, ready for the next
 * receipt.
 */
function AdvanceForm({ view, advance, onDone }: Props & { advance?: ViewAdvance; onDone: () => void }) {
  // Housemates log their own advances into the default column; only PA picks the payer and
  // column. (The server forces the same, whatever this form sends.)
  const viewer = useViewer();
  const admin = isAdmin(viewer);
  const descriptionRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const [logged, setLogged] = useState<string | null>(null);
  const { state, pending, previewing, onSubmit } = useDialogForm(
    advance ? updateAdvance : addAdvance,
    (formData) => {
      if (formData.get("intent") !== "another") return onDone();
      const amount = parseMoneyInput(String(formData.get("amount")));
      setLogged(`Logged ${formData.get("description")}${amount === null ? "" : ` · ${formatPHP(amount)}`}`);
      descriptionRef.current!.value = "";
      amountRef.current!.value = "";
      descriptionRef.current!.focus();
    },
    // "Save & add another" stays open with its own "Logged …" line instead.
    { saved: (formData) => (formData.get("intent") === "another" ? null : advance ? "Advance saved" : "Advance logged") },
  );

  const memberItems = view.members.map((m) => ({ value: String(m.id), label: m.name }));
  const categoryItems = Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label }));
  const collectorId = String(view.members.find((m) => m.isCollector)?.id ?? view.members[0]?.id);
  // "0" = the default "Advances Shared" column (created automatically if the month has none).
  const defaultColumn = view.columns.find((c) => c.isDefault);
  const columnItems = [
    ...(defaultColumn ? [] : [{ value: "0", label: "Advances Shared" }]),
    ...view.columns.map((c) => ({ value: String(c.id), label: c.name })),
  ];

  return (
    <>
      <DialogHeader>
        <DialogTitle>{advance ? "Edit advance" : "Log new advance"}</DialogTitle>
        <DialogDescription>
          {advance
            ? "Fix a detail, or pick another column to move it. Everyone's shares are recalculated."
            : "A household purchase someone paid for themselves."}
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={onSubmit} className="grid gap-4">
        {advance ? (
          <input type="hidden" name="advanceId" value={advance.id} />
        ) : (
          <input type="hidden" name="periodId" value={view.period.id} />
        )}
        <div className="grid grid-cols-2 gap-3">
          {admin ? (
            <Field label="Paid by" htmlFor="payerId">
              <SelectField id="payerId" items={memberItems} defaultValue={advance ? String(advance.payerId) : collectorId} />
            </Field>
          ) : (
            // A hidden field, not a disabled select: disabled fields aren't submitted.
            <div className="grid gap-1.5">
              <span className="text-sm font-medium">Paid by</span>
              <span className="flex h-8 items-center text-sm">{viewer.name}</span>
              <input type="hidden" name="payerId" value={viewer.memberId} />
            </div>
          )}
          <Field label="Category" htmlFor="category">
            <SelectField id="category" items={categoryItems} defaultValue={advance?.category ?? "grocery"} />
          </Field>
        </div>
        <Field label="Description" htmlFor="description">
          <Input
            ref={descriptionRef}
            id="description"
            name="description"
            placeholder="Weekly groceries"
            defaultValue={advance?.description}
            required
            maxLength={120}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount (₱)" htmlFor="amount">
            <Input
              ref={amountRef}
              id="amount"
              name="amount"
              inputMode="decimal"
              placeholder="1,500.00"
              defaultValue={advance ? fromCentavos(advance.amount) : undefined}
              required
            />
          </Field>
          <Field label="Date (optional)" htmlFor="spentOn">
            <Input
              id="spentOn"
              name="spentOn"
              type="date"
              defaultValue={advance ? (advance.spentOn ?? "") : todayInManila()}
            />
          </Field>
        </div>
        {admin ? (
          <Field label="Column" htmlFor="columnId">
            <SelectField
              id="columnId"
              items={columnItems}
              defaultValue={String(advance?.columnId ?? defaultColumn?.id ?? 0)}
            />
            <p className="text-xs text-muted-foreground">
              Which shared column this goes into. Need a new one (e.g. someone away)? Add a shared column in Manage
              first.
            </p>
          </Field>
        ) : (
          <p className="text-xs text-muted-foreground">
            Goes into {defaultColumn?.name ?? "Advances Shared"}, split by everyone. If it should be split
            differently, ask the admin to move it.
            <input type="hidden" name="columnId" value="0" />
          </p>
        )}
        {admin && <DrawerCheckbox defaultChecked={advance?.fromDrawer ?? false} />}
        {state?.ok === false && (
          <p role="alert" className="text-sm text-destructive">
            {state.error}
          </p>
        )}
        {state?.ok && logged && (
          <p role="status" className="text-sm text-emerald-700">
            {logged}
          </p>
        )}
        {previewing && <p className="text-sm text-sky-800">You&apos;re previewing, so saving is off.</p>}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" type="button" />}>{logged ? "Done" : "Cancel"}</DialogClose>
          {/* First submit button in the markup = what Enter does, so the main action comes first. */}
          <Button type="submit" disabled={pending || previewing} className="sm:order-last">
            {pending ? "Saving…" : advance ? "Save changes" : "Log advance"}
          </Button>
          {!advance && (
            <Button type="submit" name="intent" value="another" variant="outline" disabled={pending || previewing}>
              Save &amp; add another
            </Button>
          )}
        </DialogFooter>
      </form>
    </>
  );
}

type HelperKind = ViewHelperEntry["kind"];

const HELPER_FORMS: Record<
  HelperKind,
  {
    button: string;
    title: string;
    editTitle: string;
    description: string;
    amountLabel: string;
    submit: string;
    /** The toast once a new one is saved. */
    saved: string;
  }
> = {
  visit: {
    button: "Log a visit",
    title: "Log a visit",
    editTitle: "Edit visit",
    description:
      "A day she worked. Daily pay is her full pay for the day, before anything is taken off what she owes. Whoever paid her gets back the cash they handed her.",
    amountLabel: "Daily pay (₱)",
    submit: "Log visit",
    saved: "Visit logged",
  },
  early_pay: {
    button: "Give early pay",
    title: "Give early pay",
    editTitle: "Edit early pay",
    description:
      "Money given to her before she works. Whoever gave it gets it back in this month's split, and it's added to what she owes.",
    amountLabel: "Early pay (₱)",
    submit: "Save early pay",
    saved: "Early pay saved",
  },
  opening: {
    button: "Set starting debt",
    title: "Set her starting debt",
    editTitle: "Edit her starting debt",
    description:
      "What she still owes from the Google Sheet (its Remaining). It's only added to what she owes — not split, since the sheet already settled it.",
    amountLabel: "She owes (₱)",
    submit: "Save",
    saved: "Starting debt saved",
  },
};

/**
 * "Log a visit", "Give early pay" or (PA) "Set starting debt" on the Helper tab. The starting
 * debt is set once, so it's a link under "She owes" on the Helper tab rather than a button.
 */
export function AddHelperEntryDialog({ view, kind }: Props & { kind: HelperKind }) {
  const [open, setOpen] = useState(false);
  const Icon = kind === "visit" ? Plus : kind === "early_pay" ? HandCoins : NotebookPen;
  const trigger =
    kind === "opening" ? (
      <Button variant="link" className="h-auto p-0 text-amber-700" />
    ) : (
      <Button variant={kind === "visit" ? "default" : "outline"} />
    );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger}>
        <Icon />
        {HELPER_FORMS[kind].button}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <HelperEntryForm view={view} kind={kind} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

/** Edits a Helper entry (open while `entry` is set). It keeps its kind and month. */
export function EditHelperEntryDialog({
  view,
  entry,
  onClose,
}: Props & { entry: ViewHelperEntry | null; onClose: () => void }) {
  return (
    <Dialog open={entry !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        {entry && <HelperEntryForm key={entry.id} view={view} kind={entry.kind} entry={entry} onDone={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function HelperEntryForm({
  view,
  kind,
  entry,
  onDone,
}: Props & { kind: HelperKind; entry?: ViewHelperEntry; onDone: () => void }) {
  // Housemates log what they paid themselves; only PA picks who paid. (The server forces the
  // same, whatever this form sends.)
  const viewer = useViewer();
  const admin = isAdmin(viewer);
  const form = HELPER_FORMS[kind];
  const { state, pending, previewing, onSubmit } = useDialogForm(entry ? updateHelperEntry : addHelperEntry, onDone, {
    saved: entry ? "Changes saved" : form.saved,
  });
  const memberItems = view.members.map((m) => ({ value: String(m.id), label: m.name }));
  const collectorId = String(view.members.find((m) => m.isCollector)?.id ?? view.members[0]?.id);
  // What she owes before this visit's deduction (when editing, add back what it took off).
  const owes = view.helper.owesNow + (entry?.deduction ?? 0);
  // The two amounts as typed, for the "She gets … in cash" line under them (the inputs stay
  // uncontrolled, like the rest of the form).
  const [amountText, setAmountText] = useState(entry ? fromCentavos(entry.amount) : "");
  const [deductionText, setDeductionText] = useState(
    entry && entry.deduction > 0 ? fromCentavos(entry.deduction) : "",
  );
  const cashHint = kind === "visit" ? visitCashHint(amountText, deductionText) : null;

  return (
    <>
      <DialogHeader>
        <DialogTitle>{entry ? form.editTitle : form.title}</DialogTitle>
        <DialogDescription>{form.description}</DialogDescription>
      </DialogHeader>
      <form onSubmit={onSubmit} className="grid gap-4">
        {entry ? (
          <input type="hidden" name="entryId" value={entry.id} />
        ) : (
          <>
            <input type="hidden" name="periodId" value={view.period.id} />
            <input type="hidden" name="kind" value={kind} />
          </>
        )}
        <div className="grid grid-cols-2 gap-3">
          {kind === "opening" ? null : admin ? (
            <Field label={kind === "visit" ? "Paid her" : "Given by"} htmlFor="payerId">
              <SelectField
                id="payerId"
                items={memberItems}
                defaultValue={entry?.payerId ? String(entry.payerId) : collectorId}
              />
            </Field>
          ) : (
            // A hidden field, not a disabled select: disabled fields aren't submitted.
            <div className="grid gap-1.5">
              <span className="text-sm font-medium">{kind === "visit" ? "Paid her" : "Given by"}</span>
              <span className="flex h-8 items-center text-sm">{viewer.name}</span>
              <input type="hidden" name="payerId" value={viewer.memberId} />
            </div>
          )}
          <Field label="Date (optional)" htmlFor="onDate">
            <Input
              id="onDate"
              name="onDate"
              type="date"
              defaultValue={entry ? (entry.onDate ?? "") : kind === "opening" ? "" : todayInManila()}
            />
          </Field>
        </div>
        {/* items-start: the hint under "Taken off" mustn't push "Daily pay" down. */}
        <div className="grid grid-cols-2 items-start gap-3">
          <Field label={form.amountLabel} htmlFor="amount">
            <Input
              id="amount"
              name="amount"
              inputMode="decimal"
              placeholder="0.00"
              defaultValue={entry ? fromCentavos(entry.amount) : undefined}
              onChange={(e) => setAmountText(e.target.value)}
              required
            />
          </Field>
          {kind === "visit" && (
            <Field label="Taken off her debt (₱)" htmlFor="deduction">
              <Input
                id="deduction"
                name="deduction"
                inputMode="decimal"
                placeholder="0.00"
                defaultValue={entry && entry.deduction > 0 ? fromCentavos(entry.deduction) : undefined}
                onChange={(e) => setDeductionText(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {owes > 0
                  ? `She owes ${formatPHP(owes)} in all (less, if some early pay is dated after this visit).`
                  : "She owes nothing right now."}
              </p>
            </Field>
          )}
        </div>
        {cashHint &&
          (cashHint.cash < 0 ? (
            <p className="-mt-1 text-sm text-destructive">Taken off can&apos;t be more than her daily pay.</p>
          ) : (
            <p className="-mt-1 text-sm" aria-live="polite">
              She gets <strong className="font-mono">{formatPHP(cashHint.cash)}</strong> in cash
              {cashHint.takenOff > 0 && (
                <span className="text-muted-foreground">
                  {" "}
                  ({formatPHP(cashHint.pay)} − {formatPHP(cashHint.takenOff)} taken off)
                </span>
              )}
            </p>
          ))}
        <Field label="Note (optional)" htmlFor="note">
          <Input
            id="note"
            name="note"
            placeholder={kind === "visit" ? "Paid late" : ""}
            defaultValue={entry?.note ?? undefined}
            maxLength={120}
          />
        </Field>
        {admin && kind !== "opening" && <DrawerCheckbox defaultChecked={entry?.fromDrawer ?? false} />}
        {state?.ok === false && (
          <p role="alert" className="text-sm text-destructive">
            {state.error}
          </p>
        )}
        {previewing && <p className="text-sm text-sky-800">You&apos;re previewing, so saving is off.</p>}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" type="button" />}>Cancel</DialogClose>
          <Button type="submit" disabled={pending || previewing}>
            {pending ? "Saving…" : entry ? "Save changes" : form.submit}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

export interface PaymentPrefill {
  fromMemberId: Party;
  toMemberId: Party;
  /** What they owe, pre-filled; change it for a partial payment. */
  amount: Centavos;
}

/**
 * Records a payment. From a "Who still owes" row it opens pre-filled (who, to whom, the full
 * amount); without `prefill` it's for any other payment (into or out of the House Budget, or
 * between two people).
 */
export function RecordPaymentDialog({
  view,
  prefill,
  label,
  variant = "default",
  className,
}: Props & {
  prefill?: PaymentPrefill;
  label: React.ReactNode;
  variant?: "default" | "outline";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant={variant} className={className} />}>
        <HandCoins />
        {label}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <PaymentForm view={view} prefill={prefill} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

/** Edits a recorded payment (open while `payment` is set). */
export function EditPaymentDialog({
  view,
  payment,
  onClose,
}: Props & { payment: ViewPayment | null; onClose: () => void }) {
  return (
    <Dialog open={payment !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        {payment && <PaymentForm key={payment.id} view={view} payment={payment} onDone={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

/**
 * A housemate's "I paid" (docs/features/settle-up.md): the amount (pre-filled with what they
 * owe), the date, and the transfer's screenshot, which is required. It's money into the House
 * Budget, waiting for the collector to confirm it; the server sets who paid whom.
 */
export function SubmitPaymentDialog({
  view,
  owed,
  waiting,
  className,
}: Props & {
  /** What they owe now (confirmed payments only), pre-filled. */
  owed: Centavos;
  /** What they've already sent that's still waiting for PA. */
  waiting: Centavos;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className={className} />}>
        <HandCoins />I paid
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <SubmitPaymentForm view={view} owed={owed} waiting={waiting} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

/** Shrinks the screenshot in the browser (like Attach proof) before it's sent. */
async function prepareProof(formData: FormData): Promise<FormData | { error: string }> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Attach the screenshot of your transfer." };
  const smaller = await prepareReceiptFile(file);
  if (smaller.size > MAX_RECEIPT_BYTES) {
    return { error: `That screenshot is too large (the limit is ${MAX_RECEIPT_BYTES / 1024 / 1024} MB).` };
  }
  formData.set("file", smaller);
  return formData;
}

function SubmitPaymentForm({
  view,
  owed,
  waiting,
  onDone,
}: Props & { owed: Centavos; waiting: Centavos; onDone: () => void }) {
  const collector = view.members.find((m) => m.isCollector)?.name ?? "PA";
  const { state, pending, previewing, onSubmit } = useDialogForm(submitPayment, onDone, {
    saved: `Sent. It's waiting for ${collector} to check it arrived.`,
    prepare: prepareProof,
  });
  const [typed, setTyped] = useState(owed > 0 ? fromCentavos(owed) : "");
  const typedAmount = parseMoneyInput(typed);

  return (
    <>
      <DialogHeader>
        <DialogTitle>I paid into the {HOUSE_BUDGET_LABEL}</DialogTitle>
        <DialogDescription>
          Attach the screenshot of your transfer to the {HOUSE_BUDGET_LABEL}. It shows as waiting until {collector}{" "}
          checks it arrived, then it comes off what you owe.
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={onSubmit} className="grid gap-4">
        <input type="hidden" name="periodId" value={view.period.id} />
        {waiting > 0 && (
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            {formatPHP(waiting)} you sent is already waiting for {collector}. Only send this if it&apos;s another
            payment.
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount (₱)" htmlFor="amount">
            <Input
              id="amount"
              name="amount"
              inputMode="decimal"
              placeholder="1,500.00"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              required
            />
          </Field>
          <Field label="Date paid" htmlFor="paidOn">
            <Input id="paidOn" name="paidOn" type="date" defaultValue={todayInManila()} required />
          </Field>
        </div>
        {owed > 0 && typedAmount !== null && typedAmount > owed && (
          <p className="text-xs text-amber-700">
            More than the {formatPHP(owed)} you owe. You&apos;ll be owed the difference.
          </p>
        )}
        <Field label="Screenshot of the transfer" htmlFor="file">
          {/* No `capture`: that would force the camera, and most proofs are screenshots. */}
          <Input id="file" name="file" type="file" accept="image/*" required />
        </Field>
        <Field label="Note (optional)" htmlFor="note">
          <Input id="note" name="note" placeholder="GCash" maxLength={120} />
        </Field>
        {state?.ok === false && (
          <p role="alert" className="text-sm text-destructive">
            {state.error}
          </p>
        )}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" type="button" />}>Cancel</DialogClose>
          <Button type="submit" disabled={pending || previewing}>
            {pending ? "Sending…" : "Send to " + collector}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

function PaymentForm({
  view,
  payment,
  prefill,
  onDone,
}: Props & { payment?: ViewPayment; prefill?: PaymentPrefill; onDone: () => void }) {
  const { state, pending, previewing, onSubmit } = useDialogForm(payment ? updatePayment : addPayment, onDone, {
    saved: payment ? "Payment saved" : "Payment recorded",
  });
  const [typed, setTyped] = useState(prefill ? fromCentavos(prefill.amount) : "");
  const typedAmount = parseMoneyInput(typed);
  const memberOf = new Map(view.members.map((m) => [m.id, m]));
  // Either side can be the House Budget (the server refuses it on both).
  const partyItems = [
    ...view.members.map((m) => ({ value: String(m.id), label: m.name })),
    { value: HOUSE_BUDGET, label: HOUSE_BUDGET_LABEL },
  ];
  const collector = view.members.find((m) => m.isCollector) ?? view.members[0];
  const firstOther = view.members.find((m) => m.id !== collector?.id) ?? collector;
  const from = payment?.fromMemberId ?? prefill?.fromMemberId ?? firstOther?.id;
  // Housemates pay into the House Budget, so that's the usual receiver.
  const to = payment?.toMemberId ?? prefill?.toMemberId ?? HOUSE_BUDGET;

  return (
    <>
      <DialogHeader>
        <DialogTitle>{payment ? "Edit payment" : "Record payment"}</DialogTitle>
        <DialogDescription>
          {prefill
            ? `${partyName(prefill.fromMemberId, memberOf)} → ${partyName(prefill.toMemberId, memberOf)}. Change the amount if it was only part of it.`
            : `Money that changed hands to settle up, into or out of the ${HOUSE_BUDGET_LABEL}. It comes off the Final on each side.`}
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={onSubmit} className="grid gap-4">
        {payment ? (
          <input type="hidden" name="paymentId" value={payment.id} />
        ) : (
          <input type="hidden" name="periodId" value={view.period.id} />
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Paid by" htmlFor="fromMemberId">
            <SelectField id="fromMemberId" items={partyItems} defaultValue={String(from)} />
          </Field>
          <Field label="Paid to" htmlFor="toMemberId">
            <SelectField id="toMemberId" items={partyItems} defaultValue={String(to)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount (₱)" htmlFor="amount">
            <Input
              id="amount"
              name="amount"
              inputMode="decimal"
              placeholder="1,500.00"
              defaultValue={payment ? fromCentavos(payment.amount) : typed}
              onChange={(e) => setTyped(e.target.value)}
              required
            />
          </Field>
          <Field label="Date paid" htmlFor="paidOn">
            <Input id="paidOn" name="paidOn" type="date" defaultValue={payment?.paidOn ?? todayInManila()} required />
          </Field>
        </div>
        {prefill && typedAmount !== null && typedAmount > prefill.amount && (
          <p className="text-xs text-amber-700">
            More than the {formatPHP(prefill.amount)} owed.{" "}
            {prefill.fromMemberId === HOUSE_BUDGET
              ? `${partyName(prefill.toMemberId, memberOf)} will owe the difference back.`
              : `${partyName(prefill.fromMemberId, memberOf)} will be owed the difference.`}
          </p>
        )}
        <Field label="Note (optional)" htmlFor="note">
          <Input id="note" name="note" placeholder="GCash" defaultValue={payment?.note ?? ""} maxLength={120} />
        </Field>
        {state?.ok === false && (
          <p role="alert" className="text-sm text-destructive">
            {state.error}
          </p>
        )}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" type="button" />}>Cancel</DialogClose>
          <Button type="submit" disabled={pending || previewing}>
            {pending ? "Saving…" : payment ? "Save changes" : "Record payment"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

export function AddBillDialog({ view, label = "Add bill column" }: Props & { label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Plus />
        {label}
      </DialogTrigger>
      <DialogContent>
        <AddBillForm view={view} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function AddBillForm({ view, onDone }: Props & { onDone: () => void }) {
  const { state, pending, previewing, onSubmit } = useDialogForm(addBill, onDone, { saved: "Bill column added" });
  const [splitMode, setSplitMode] = useState<"equal" | "manual">("equal");
  const memberItems = view.members.map((m) => ({ value: String(m.id), label: m.name }));
  const collectorId = String(view.members.find((m) => m.isCollector)?.id ?? view.members[0]?.id);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Add bill column</DialogTitle>
        <DialogDescription>
          A utility or service bill. Choose how it&apos;s split — this stays fixed for the column.
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={onSubmit} className="grid gap-4">
        <input type="hidden" name="periodId" value={view.period.id} />
        <Field label="Bill name" htmlFor="name">
          <Input id="name" name="name" placeholder="Meralco" required maxLength={60} />
        </Field>
        <ModeChoice
          value={splitMode}
          onChange={setSplitMode}
          equalHint="Everyone pays the same share of the total."
          manualHint="Type each person's amount in the table; the total is their sum."
        />
        {splitMode === "equal" && (
          <Field label="Total (₱)" htmlFor="total">
            <Input id="total" name="total" inputMode="decimal" placeholder="0.00 if not in yet" defaultValue="0" required />
          </Field>
        )}
        <Field label="Paid to the provider by" htmlFor="paidById">
          <SelectField id="paidById" items={memberItems} defaultValue={collectorId} />
        </Field>
        {state?.ok === false && (
          <p role="alert" className="text-sm text-destructive">
            {state.error}
          </p>
        )}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" type="button" />}>Cancel</DialogClose>
          <Button type="submit" disabled={pending || previewing}>
            {pending ? "Saving…" : "Add bill"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

export function AddMemberDialog({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" className={className} />}>
        <UserPlus />
        Add member
      </DialogTrigger>
      <DialogContent>
        <AddMemberForm onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function AddMemberForm({ onDone }: { onDone: () => void }) {
  const { state, pending, previewing, onSubmit } = useDialogForm(addMember, onDone, {
    saved: (formData) => (formData.get("viewOnly") ? "View-only login added" : "Housemate added"),
  });
  const [viewOnly, setViewOnly] = useState(false);
  return (
    <>
      <DialogHeader>
        <DialogTitle>{viewOnly ? "Add a view-only login" : "Add housemate"}</DialogTitle>
        <DialogDescription>
          {viewOnly
            ? "For someone who should only look (say, family abroad). They see what housemates see, change nothing, and join no month, so they share in nothing. Someone who was in past months can't be view only."
            : "They join every open month: equal bills are re-split to include them, and points bills give them 0 points until you set theirs."}
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={onSubmit} className="grid gap-4">
        <Field label="Name" htmlFor="member-name">
          <Input id="member-name" name="name" placeholder="Name" required maxLength={40} />
        </Field>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="viewOnly"
            checked={viewOnly}
            onChange={(e) => setViewOnly(e.target.checked)}
            className="mt-0.5 accent-amber-600"
          />
          <span>
            View only <span className="text-muted-foreground">— sees what housemates see, shares in no costs</span>
          </span>
        </label>
        {state?.ok === false && (
          <p role="alert" className="text-sm text-destructive">
            {state.error}
          </p>
        )}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" type="button" />}>Cancel</DialogClose>
          <Button type="submit" disabled={pending || previewing}>
            {pending ? "Adding…" : viewOnly ? "Add view-only login" : "Add housemate"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

export function AddSharedColumnDialog({ view }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" />}>
        <Columns3 />
        Add shared column
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <AddSharedColumnForm view={view} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function AddSharedColumnForm({ view, onDone }: Props & { onDone: () => void }) {
  const { state, pending, previewing, onSubmit } = useDialogForm(addSharedColumn, onDone, { saved: "Shared column added" });
  const [splitMode, setSplitMode] = useState<"equal" | "manual">("equal");
  const [sharedMode, setSharedMode] = useState<"all" | "except">("all");

  return (
    <>
      <DialogHeader>
        <DialogTitle>Add shared column</DialogTitle>
        <DialogDescription>
          For advances that aren&apos;t shared the usual way — e.g. &ldquo;Advances Shared w/o PA&rdquo; while someone
          is away, or &ldquo;Ice Maker Adj.&rdquo; when one person carries more.
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={onSubmit} className="grid gap-4">
        <input type="hidden" name="periodId" value={view.period.id} />
        <Field label="Column name" htmlFor="column-name">
          <Input id="column-name" name="name" placeholder="Advances Shared w/o PA" required maxLength={60} />
        </Field>
        <ModeChoice
          value={splitMode}
          onChange={setSplitMode}
          equalHint="Split evenly among the people you pick."
          manualHint="Type each person's amount in the table."
        />
        {splitMode === "equal" && (
          <fieldset className="grid gap-2">
            <legend className="mb-1.5 text-sm font-medium">Shared by</legend>
            <div className="flex gap-4 text-sm">
              {(["all", "except"] as const).map((mode) => (
                <label key={mode} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="sharedMode"
                    value={mode}
                    checked={sharedMode === mode}
                    onChange={() => setSharedMode(mode)}
                    className="accent-amber-600"
                  />
                  {mode === "all" ? "Everyone" : "Everyone except…"}
                </label>
              ))}
            </div>
            {sharedMode === "except" && (
              <div className="flex flex-wrap gap-x-4 gap-y-2 rounded-lg bg-zinc-50 p-3 text-sm">
                {view.members.map((m) => (
                  <label key={m.id} className="flex items-center gap-2">
                    <input type="checkbox" name="excluded" value={m.id} className="accent-amber-600" />
                    {m.name}
                  </label>
                ))}
              </div>
            )}
          </fieldset>
        )}
        {state?.ok === false && (
          <p role="alert" className="text-sm text-destructive">
            {state.error}
          </p>
        )}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" type="button" />}>Cancel</DialogClose>
          <Button type="submit" disabled={pending || previewing}>
            {pending ? "Adding…" : "Add column"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

/** A Select whose value is submitted with the form under `id` as its name. */
// ---------- Billers (docs/features/billers.md) ----------

export function AddBillerDialog() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" />}>
        <Plus />
        Add biller
      </DialogTrigger>
      <DialogContent>
        <AddBillerForm onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function AddBillerForm({ onDone }: { onDone: () => void }) {
  const { state, pending, previewing, onSubmit } = useDialogForm(addBiller, onDone, { saved: "Biller added" });
  return (
    <>
      <DialogHeader>
        <DialogTitle>Add biller</DialogTitle>
        <DialogDescription>A company the household pays. Add its account details as lines after.</DialogDescription>
      </DialogHeader>
      <form onSubmit={onSubmit} className="grid gap-4">
        <Field label="Name" htmlFor="biller-name">
          <Input id="biller-name" name="name" placeholder="Meralco" required maxLength={60} />
        </Field>
        {state?.ok === false && (
          <p role="alert" className="text-sm text-destructive">
            {state.error}
          </p>
        )}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" type="button" />}>Cancel</DialogClose>
          <Button type="submit" disabled={pending || previewing}>
            {pending ? "Adding…" : "Add biller"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

type BillerFieldKind = "text" | "link" | "secret" | "heading";

const BILLER_FIELD_KINDS: { value: BillerFieldKind; label: string }[] = [
  { value: "text", label: "Text (account number, name…)" },
  { value: "link", label: "Link" },
  { value: "secret", label: "Password (stored encrypted)" },
  { value: "heading", label: "Heading (e.g. FAQs)" },
];

export function AddBillerFieldDialog({ billerId, billerName }: { billerId: number; billerName: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="sm" />}>
        <Plus />
        Add line
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <AddBillerFieldForm billerId={billerId} billerName={billerName} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function AddBillerFieldForm({ billerId, billerName, onDone }: { billerId: number; billerName: string; onDone: () => void }) {
  const { state, pending, previewing, onSubmit } = useDialogForm(addBillerField, onDone, { saved: "Line added" });
  const [kind, setKind] = useState<BillerFieldKind>("text");
  return (
    <>
      <DialogHeader>
        <DialogTitle>Add a line to {billerName}</DialogTitle>
        <DialogDescription>An account number, a link, a password, or a heading to group the lines below it.</DialogDescription>
      </DialogHeader>
      <form onSubmit={onSubmit} className="grid gap-4" autoComplete="off">
        <input type="hidden" name="billerId" value={billerId} />
        <Field label="Kind" htmlFor="kind">
          <Select name="kind" items={BILLER_FIELD_KINDS} value={kind} onValueChange={(v) => setKind((v as BillerFieldKind) ?? "text")}>
            <SelectTrigger id="kind" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BILLER_FIELD_KINDS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label={kind === "heading" ? "Heading" : "Label"} htmlFor="field-label">
          <Input
            id="field-label"
            name="label"
            placeholder={kind === "heading" ? "FAQs" : kind === "secret" ? "Wi-Fi password" : "Account number"}
            required
            maxLength={60}
          />
        </Field>
        {kind !== "heading" && (
          <Field label={kind === "secret" ? "Password" : kind === "link" ? "Link" : "Value"} htmlFor="field-value">
            <Input
              id="field-value"
              name="value"
              // "new-password": the browser shouldn't offer to save it as the My House login.
              type={kind === "secret" ? "password" : kind === "link" ? "url" : "text"}
              autoComplete={kind === "secret" ? "new-password" : "off"}
              placeholder={kind === "link" ? "https://" : undefined}
              maxLength={kind === "secret" ? 200 : 500}
            />
          </Field>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="housematesCanSee" defaultChecked className="accent-amber-600" />
          Housemates can see this
        </label>
        {state?.ok === false && (
          <p role="alert" className="text-sm text-destructive">
            {state.error}
          </p>
        )}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" type="button" />}>Cancel</DialogClose>
          <Button type="submit" disabled={pending || previewing}>
            {pending ? "Adding…" : "Add line"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

/** A password is never shown back here: the field always starts empty, and saving replaces it. */
export function ChangeBillerSecretDialog({ fieldId, label }: { fieldId: number; label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Change ${label}`} className="text-muted-foreground" />}>
        <KeyRound />
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <ChangeBillerSecretForm fieldId={fieldId} label={label} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function ChangeBillerSecretForm({ fieldId, label, onDone }: { fieldId: number; label: string; onDone: () => void }) {
  const { state, pending, previewing, onSubmit } = useDialogForm(setBillerSecret, onDone, {
    // Never the password itself: only whether one was saved.
    saved: (formData) => (formData.get("secret") ? "Password saved" : "Password cleared"),
  });
  return (
    <>
      <DialogHeader>
        <DialogTitle>Change {label}</DialogTitle>
        <DialogDescription>
          Saved encrypted, in place of the old one. Leave it empty and save to clear it.
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={onSubmit} className="grid gap-4" autoComplete="off">
        <input type="hidden" name="fieldId" value={fieldId} />
        <Field label="New password" htmlFor="new-secret">
          <Input id="new-secret" name="secret" type="password" autoComplete="new-password" maxLength={200} />
        </Field>
        {state?.ok === false && (
          <p role="alert" className="text-sm text-destructive">
            {state.error}
          </p>
        )}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" type="button" />}>Cancel</DialogClose>
          <Button type="submit" disabled={pending || previewing}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

type DrawerEntry = Extract<DrawerLine, { source: "drawer" }>;

const DRAWER_KIND_ITEMS = (Object.entries(DRAWER_KIND_LABELS) as [DrawerKind, string][]).map(([value, label]) => ({
  value,
  label,
}));

const DRAWER_KIND_HINTS: Record<DrawerKind, string> = {
  cash_in: "Money put in: taken out of the bank, or what's in the drawer when you start.",
  spent: "Paid out for something not logged in My House. A Helper visit or an advance? Tick “Paid from the cash drawer” on it instead.",
  lent: "Someone borrowed from the drawer. It shows under Owed until it's paid back.",
  paid_back: "Someone returned what they borrowed.",
};

/** "Add entry" on the Cash Drawer tab (docs/features/cash-drawer.md). `people`: names typed before. */
export function AddDrawerEntryDialog({ people }: { people: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Plus />
        Add entry
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DrawerEntryForm people={people} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

/** Edits one of the drawer's own entries (open while `entry` is set). */
export function EditDrawerEntryDialog({
  entry,
  people,
  onClose,
}: {
  entry: DrawerEntry | null;
  people: string[];
  onClose: () => void;
}) {
  return (
    <Dialog open={entry !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        {entry && <DrawerEntryForm key={entry.id} entry={entry} people={people} onDone={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function DrawerEntryForm({ entry, people, onDone }: { entry?: DrawerEntry; people: string[]; onDone: () => void }) {
  const { state, pending, previewing, onSubmit } = useDialogForm(entry ? updateDrawerEntry : addDrawerEntry, onDone, {
    saved: entry ? "Changes saved" : "Entry added",
  });
  const [kind, setKind] = useState<DrawerKind>(entry?.kind ?? "cash_in");
  const loan = kind === "lent" || kind === "paid_back";
  return (
    <>
      <DialogHeader>
        <DialogTitle>{entry ? "Edit entry" : "Add to the cash drawer"}</DialogTitle>
        <DialogDescription>{DRAWER_KIND_HINTS[kind]}</DialogDescription>
      </DialogHeader>
      <form onSubmit={onSubmit} className="grid gap-4" autoComplete="off">
        {entry && <input type="hidden" name="entryId" value={entry.id} />}
        <div className="grid grid-cols-2 gap-3">
          <Field label="What" htmlFor="kind">
            <Select
              name="kind"
              items={DRAWER_KIND_ITEMS}
              value={kind}
              onValueChange={(v) => setKind((v as DrawerKind) ?? "cash_in")}
            >
              <SelectTrigger id="kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DRAWER_KIND_ITEMS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Date" htmlFor="onDate">
            <Input id="onDate" name="onDate" type="date" defaultValue={entry?.onDate ?? todayInManila()} required />
          </Field>
        </div>
        <div className="grid grid-cols-2 items-start gap-3">
          <Field label="Amount (₱)" htmlFor="amount">
            <Input
              id="amount"
              name="amount"
              inputMode="decimal"
              placeholder="0.00"
              defaultValue={entry ? fromCentavos(entry.amount) : undefined}
              required
            />
          </Field>
          {loan && (
            <Field label={kind === "lent" ? "Who borrowed" : "Who paid back"} htmlFor="person">
              <Input
                id="person"
                name="person"
                list="drawer-people"
                defaultValue={entry?.person ?? undefined}
                required
                maxLength={60}
              />
              <datalist id="drawer-people">
                {people.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </Field>
          )}
        </div>
        <Field label="Note (optional)" htmlFor="note">
          <Input
            id="note"
            name="note"
            placeholder={kind === "cash_in" ? "From the bank" : ""}
            defaultValue={entry?.note ?? undefined}
            maxLength={120}
          />
        </Field>
        {state?.ok === false && (
          <p role="alert" className="text-sm text-destructive">
            {state.error}
          </p>
        )}
        {previewing && <p className="text-sm text-sky-800">You&apos;re previewing, so saving is off.</p>}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" type="button" />}>Cancel</DialogClose>
          <Button type="submit" disabled={pending || previewing}>
            {pending ? "Saving…" : entry ? "Save changes" : "Add entry"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

function SelectField({
  id,
  items,
  defaultValue,
}: {
  id: string;
  items: { value: string; label: string }[];
  defaultValue: string;
}) {
  return (
    <Select name={id} items={items} defaultValue={defaultValue}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ModeChoice({
  value,
  onChange,
  equalHint,
  manualHint,
}: {
  value: "equal" | "manual";
  onChange: (value: "equal" | "manual") => void;
  equalHint: string;
  manualHint: string;
}) {
  return (
    <fieldset className="grid gap-1.5">
      <legend className="mb-1.5 text-sm font-medium">Split</legend>
      <div className="flex gap-4 text-sm">
        {(["equal", "manual"] as const).map((mode) => (
          <label key={mode} className="flex items-center gap-2">
            <input
              type="radio"
              name="splitMode"
              value={mode}
              checked={value === mode}
              onChange={() => onChange(mode)}
              className="accent-amber-600"
            />
            {mode === "equal" ? "Auto equal" : "Manual"}
          </label>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{value === "equal" ? equalHint : manualHint}</p>
    </fieldset>
  );
}

/**
 * The admin's "Paid from the cash drawer" on a Helper entry or an advance
 * (docs/features/cash-drawer.md). The server checks it's what he paid himself, with a date.
 */
function DrawerCheckbox({ defaultChecked }: { defaultChecked: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" name="fromDrawer" defaultChecked={defaultChecked} className="accent-amber-600" />
      Paid from the cash drawer
    </label>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}
