import { kotMarkup, printKOT, type KOTTicketData } from "./kot-markup";
import { TICKET_WIDTH, type TicketPaper } from "./ticket-style";

interface KOTTicketProps {
  ticket: KOTTicketData;
  showPrintButton?: boolean;
  printSize?: TicketPaper;
}

/**
 * On-screen preview of a KOT.
 *
 * Renders `kotMarkup` — literally the same string `printKOT` sends to the
 * printer — so the cashier approves exactly what the kitchen receives. Keeping
 * a separate JSX layout here is what previously let the two drift apart.
 */
export default function KOTTicket({
  ticket,
  showPrintButton = true,
  printSize = "58mm",
}: KOTTicketProps) {
  return (
    <div className="relative">
      {showPrintButton && (
        <button
          onClick={() => printKOT(ticket, printSize)}
          className="no-print mb-3 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          Print KOT
        </button>
      )}
      <div
        className="rounded border border-border bg-white p-4 text-black"
        style={{ width: TICKET_WIDTH[printSize], margin: "0 auto" }}
        dangerouslySetInnerHTML={{ __html: kotMarkup(ticket, printSize) }}
      />
    </div>
  );
}
