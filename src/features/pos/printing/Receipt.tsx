import { useRef } from "react";
import { PosReceiptData } from "../api";

function formatRM(amount: string | number) {
  return `Rs ${Number(amount).toFixed(2)}`;
}

function formatDate(iso: string | null) {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleString("en-MY", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const DIVIDER = "--------------------------------";

interface ReceiptProps {
  data: PosReceiptData;
  printSize?: "58mm" | "80mm" | "a4";
  showPrintButton?: boolean;
}

export default function Receipt({
  data,
  printSize = "80mm",
  showPrintButton = true,
}: ReceiptProps) {
  const receiptRef = useRef<HTMLDivElement>(null);

  const handlePrint = () => {
    if (!receiptRef.current) return;
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    const printCSS = `
      @page { size: ${printSize} auto; margin: 4mm; }
      * { box-sizing: border-box; }
      body {
        font-family: "Courier New", "Lucida Console", monospace;
        font-size: ${printSize === "58mm" ? "10px" : printSize === "80mm" ? "12px" : "12px"};
        line-height: 1.3;
        margin: 0; padding: 0;
        color: #000; background: #fff;
        width: ${printSize === "58mm" ? "48mm" : printSize === "80mm" ? "72mm" : "190mm"};
      }
      .receipt-wrap { width: 100%; }
      .receipt-center { text-align: center; }
      .receipt-bold { font-weight: bold; }
      .receipt-line { display: flex; justify-content: space-between; width: 100%; }
      .receipt-divider { border: none; border-top: 1px dashed #000; margin: 4px 0; width: 100%; }
      .receipt-divider-thick { border: none; border-top: 2px solid #000; margin: 6px 0; width: 100%; }
      .receipt-item-row { display: flex; justify-content: space-between; }
      .receipt-total-row { display: flex; justify-content: space-between; font-weight: bold; font-size: 130%; }
      .receipt-subtext { font-size: 0.85em; color: #444; }
      .receipt-footer { margin-top: 8px; text-align: center; font-size: 0.9em; }
      .receipt-offline-badge {
        display: inline-block; border: 1px solid #000; padding: 1px 4px;
        font-size: 0.8em; margin-top: 4px;
      }
      @media print {
        html, body { width: ${printSize === "58mm" ? "48mm" : printSize === "80mm" ? "72mm" : "190mm"}; }
        .no-print { display: none !important; }
      }
    `;

    printWindow.document.write(`
      <!DOCTYPE html>
      <html><head><title>Receipt #${data.order_number}</title>
      <style>${printCSS}</style></head>
      <body>
        <div class="receipt-wrap">
          ${receiptRef.current.innerHTML}
        </div>
      </body></html>
    `);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 300);
  };

  const merchantName = data.merchant?.name || "ZENTRO";

  return (
    <div className="relative">
      {showPrintButton && (
        <button
          onClick={handlePrint}
          className="no-print mb-3 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          Print {data.type === "receipt" ? "Receipt" : "Bill"}
        </button>
      )}

      <div
        ref={receiptRef}
        className={`receipt-print receipt-${printSize} rounded border border-border bg-white p-4 font-mono text-sm`}
      >
        {/* ── Header ── */}
        <div className="text-center">
          {data.merchant?.logo_url && (
            <img
              src={data.merchant.logo_url}
              alt=""
              className="mx-auto mb-1 h-8 w-8 object-contain"
              crossOrigin="anonymous"
            />
          )}
          <p className="text-base font-bold tracking-wide">{merchantName}</p>
          {data.merchant?.address && (
            <p className="text-xs text-muted-foreground">{data.merchant.address}</p>
          )}
          {data.merchant?.phone && (
            <p className="text-xs text-muted-foreground">{data.merchant.phone}</p>
          )}
        </div>

        <hr className="receipt-divider my-2" />

        {/* ── Order info ── */}
        <div className="space-y-0.5 text-xs">
          <div className="receipt-line">
            <span>Order</span>
            <span className="receipt-bold">{data.order_number}</span>
          </div>
          {data.kot_number && (
            <div className="receipt-line">
              <span>KOT</span>
              <span className="receipt-bold">#{String(data.kot_number).padStart(3, "0")}</span>
            </div>
          )}
          <div className="receipt-line">
            <span>Date</span>
            <span>{formatDate(data.created_at || data.client_created_at)}</span>
          </div>
          <div className="receipt-line">
            <span>Type</span>
            <span className="capitalize">{data.fulfillment_type}</span>
          </div>
          {data.table && (
            <div className="receipt-line">
              <span>Table</span>
              <span>
                {data.table.name || `#${data.table.number}`}
              </span>
            </div>
          )}
          {data.customer_name && (
            <div className="receipt-line">
              <span>Customer</span>
              <span>{data.customer_name}</span>
            </div>
          )}
          {data.worker_name && (
            <div className="receipt-line">
              <span>Served by</span>
              <span>{data.worker_name}</span>
            </div>
          )}
        </div>

        <hr className="receipt-divider-thick my-2" />

        {/* ── Items ── */}
        <div className="space-y-1 text-xs">
          {data.items.map((item, i) => (
            <div key={i}>
              <div className="receipt-item-row">
                <span className="receipt-bold">
                  {item.quantity}x {item.name}
                </span>
                <span>{formatRM(item.subtotal)}</span>
              </div>
              {item.quantity > 1 && (
                <div className="receipt-subtext text-right">
                  @ {formatRM(item.price)} each
                </div>
              )}
            </div>
          ))}
        </div>

        <hr className="receipt-divider my-2" />

        {/* ── Totals ── */}
        <div className="space-y-0.5 text-xs">
          <div className="receipt-line">
            <span>Subtotal</span>
            <span>{formatRM(data.subtotal)}</span>
          </div>
          {data.discounts.map((d, i) => (
            <div key={i} className="receipt-line text-green-700">
              <span>
                Discount{" "}
                {d.type === "percentage" ? `(${d.value}%)` : ""}
              </span>
              <span>-{formatRM(d.amount)}</span>
            </div>
          ))}
          {Number(data.discount_amount) > 0 && (
            <div className="receipt-line text-green-700">
              <span>Total Discount</span>
              <span>-{formatRM(data.discount_amount)}</span>
            </div>
          )}
          {Number(data.tax_amount) > 0 && (
            <div className="receipt-line">
              <span>VAT</span>
              <span>{formatRM(data.tax_amount)}</span>
            </div>
          )}
          {Number(data.service_charge) > 0 && (
            <div className="receipt-line">
              <span>Service Charge</span>
              <span>{formatRM(data.service_charge)}</span>
            </div>
          )}
          <hr className="receipt-divider-thick my-2" />
          <div className="receipt-total-row">
            <span>TOTAL</span>
            <span>{formatRM(data.total_amount)}</span>
          </div>
        </div>

        {/* ── Payments (receipt only) ── */}
        {data.type === "receipt" && data.payments.length > 0 && (
          <>
            <hr className="receipt-divider my-2" />
            <div className="space-y-0.5 text-xs">
              <p className="receipt-bold">Payment</p>
              {data.payments.map((p, i) => (
                <div key={i} className="receipt-line">
                  <span className="capitalize">{p.method.replace("_", " ")}</span>
                  <span>{formatRM(p.amount)}</span>
                </div>
              ))}
              <div className="receipt-line">
                <span>Paid</span>
                <span>{formatRM(data.total_paid)}</span>
              </div>
              {Number(data.change) > 0 && (
                <div className="receipt-line receipt-bold">
                  <span>Change</span>
                  <span>{formatRM(data.change)}</span>
                </div>
              )}
              <div className="receipt-line">
                <span>Payment Status</span>
                <span className="receipt-bold uppercase">{data.payment_status}</span>
              </div>
            </div>
          </>
        )}

        {/* ── Footer ── */}
        <hr className="receipt-divider my-2" />
        <div className="receipt-footer text-xs">
          {data.payment_status !== "paid" && data.payment_status !== "fulfilled" ? (
            <p className="receipt-bold">** AWAITING PAYMENT **</p>
          ) : (
            <p className="receipt-bold">Thank you!</p>
          )}
          {data.is_offline_receipt && (
            <span className="receipt-offline-badge">
              OFFLINE - Pending Sync
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
