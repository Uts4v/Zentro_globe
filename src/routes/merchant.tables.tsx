// routes/merchant.tables.tsx — Merchant table management & QR codes
import { createFileRoute, Link } from "@tanstack/react-router";
import { requireMerchant } from "@/lib/merchant-auth-guard";
import { useCallback, useEffect, useState } from "react";
import {
  Loader2,
  Plus,
  Trash2,
  RefreshCw,
  Download,
  QrCode,
  ToggleLeft,
  ToggleRight,
  Pencil,
  X,
  Printer,
} from "lucide-react";
import { tableApi, merchantApi, type MerchantTable, type MerchantProfile } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";

export const Route = createFileRoute("/merchant/tables")({
  beforeLoad: requireMerchant,
  head: () => ({ meta: [{ title: "Tables & QR · Merchant · Zentro" }] }),
  component: MerchantTablesPage,
});

function MerchantTablesPage() {
  const { merchantProfile } = useAuth();
  const [tables, setTables] = useState<MerchantTable[]>([]);
  const [profile, setProfile] = useState<MerchantProfile | null>(
    merchantProfile ? { ...merchantProfile, id: String(merchantProfile.id) } as MerchantProfile : null
  );
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generateCount, setGenerateCount] = useState(10);
  const [generatePrefix, setGeneratePrefix] = useState("Table");
  const [editingTable, setEditingTable] = useState<MerchantTable | null>(null);
  const [editName, setEditName] = useState("");
  const [qrPreview, setQrPreview] = useState<MerchantTable | null>(null);
  const [togglingSetting, setTogglingSetting] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [tablesData, profileData] = await Promise.all([
        tableApi.list(),
        merchantApi.me(),
      ]);
      setTables(tablesData);
      setProfile(profileData);
    } catch {
      toast.error("Failed to load tables");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleGenerate = async () => {
    if (generateCount < 1 || generateCount > 200) return;
    setGenerating(true);
    try {
      await tableApi.generate(generateCount, generatePrefix);
      toast.success(`${generateCount} tables generated!`);
      await fetchData();
    } catch (e: any) {
      toast.error(e.message || "Failed to generate tables");
    } finally {
      setGenerating(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this table? This cannot be undone.")) return;
    try {
      await tableApi.delete(id);
      setTables((prev) => prev.filter((t) => t.id !== id));
      toast.success("Table deleted");
    } catch (e: any) {
      toast.error(e.message || "Failed to delete table");
    }
  };

  const handleToggleActive = async (table: MerchantTable) => {
    try {
      const updated = await tableApi.update(table.id, { is_active: !table.is_active });
      setTables((prev) => prev.map((t) => (t.id === table.id ? updated : t)));
      toast.success(updated.is_active ? "Table activated" : "Table deactivated");
    } catch (e: any) {
      toast.error(e.message || "Failed to update table");
    }
  };

  const handleRegenerateQR = async (table: MerchantTable) => {
    if (!confirm(`Regenerate QR for ${table.name}? The old QR code will stop working.`)) return;
    try {
      const updated = await tableApi.regenerateQR(table.id);
      setTables((prev) => prev.map((t) => (t.id === table.id ? updated : t)));
      toast.success("QR code regenerated");
    } catch (e: any) {
      toast.error(e.message || "Failed to regenerate QR");
    }
  };

  const handleRename = async () => {
    if (!editingTable || !editName.trim()) return;
    try {
      const updated = await tableApi.update(editingTable.id, { name: editName.trim() });
      setTables((prev) => prev.map((t) => (t.id === editingTable.id ? updated : t)));
      setEditingTable(null);
      toast.success("Table renamed");
    } catch (e: any) {
      toast.error(e.message || "Failed to rename table");
    }
  };

  const handleToggleTableOrdering = async () => {
    if (!profile) return;
    setTogglingSetting(true);
    try {
      const updated = await merchantApi.update({
        table_ordering_enabled: !profile.table_ordering_enabled,
      });
      setProfile(updated);
      toast.success(updated.table_ordering_enabled ? "Table ordering enabled" : "Table ordering disabled");
    } catch (e: any) {
      toast.error(e.message || "Failed to update setting");
    } finally {
      setTogglingSetting(false);
    }
  };

  const getTableQRUrl = (table: MerchantTable) => {
    const slug = profile?.slug || "";
    return `${window.location.origin}/m/${slug}/table/${table.public_token}`;
  };

  const downloadQR = (table: MerchantTable) => {
    const svgEl = document.getElementById(`qr-${table.id}`)?.querySelector("svg");
    if (!svgEl) return;

    const svgData = new XMLSerializer().serializeToString(svgEl);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const img = new Image();

    img.onload = () => {
      canvas.width = 400;
      canvas.height = 500;
      if (ctx) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, 400, 500);

        ctx.fillStyle = "#000000";
        ctx.font = "bold 20px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(profile?.business_name || "", 200, 35);

        ctx.font = "16px sans-serif";
        ctx.fillText(table.name, 200, 60);

        const qrSize = 280;
        const qrX = (400 - qrSize) / 2;
        ctx.drawImage(img, qrX, 80, qrSize, qrSize);

        ctx.font = "12px sans-serif";
        ctx.fillStyle = "#666666";
        ctx.fillText("Scan to view menu and order", 200, 400);
        ctx.fillText("Powered by Zentro", 200, 430);

        const link = document.createElement("a");
        link.download = `${table.name.replace(/\s+/g, "-").toLowerCase()}-qr.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
      }
    };

    img.src = "data:image/svg+xml;base64," + btoa(svgData);
  };

  const handlePrintQR = (table: MerchantTable) => {
    const qrUrl = getTableQRUrl(table);
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>${table.name} - QR Code</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: 'Segoe UI', system-ui, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #f8f9fa; }
          .card { background: white; border-radius: 16px; padding: 32px; text-align: center; box-shadow: 0 4px 20px rgba(0,0,0,0.08); max-width: 320px; width: 100%; }
          .merchant-name { font-size: 18px; font-weight: 700; color: #1a1a1a; margin-bottom: 4px; }
          .table-name { font-size: 14px; color: #6b7280; margin-bottom: 24px; text-transform: uppercase; letter-spacing: 0.1em; }
          .qr-container { display: flex; justify-content: center; margin-bottom: 24px; }
          .instruction { font-size: 13px; color: #9ca3af; margin-bottom: 8px; }
          .powered { font-size: 11px; color: #d1d5db; margin-top: 16px; }
          @media print { body { background: white; } .card { box-shadow: none; border: 1px solid #e5e7eb; } }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="merchant-name">${profile?.business_name || ""}</div>
          <div class="table-name">${table.name}</div>
          <div class="qr-container">
            <div id="qr-target"></div>
          </div>
          <div class="instruction">Scan to view menu and order</div>
          <div class="powered">Powered by Zentro</div>
        </div>
        <script src="https://cdn.jsdelivr.net/npm/qrcode/build/qrcode.min.js"><\/script>
        <script>
          QRCode.toCanvas(document.createElement('canvas'), '${qrUrl}', {
            width: 200,
            margin: 2,
            color: { dark: '#000000', light: '#ffffff' }
          }, function(err, canvas) {
            if (!err) {
              document.getElementById('qr-target').appendChild(canvas);
              setTimeout(function() { window.print(); }, 500);
            }
          });
        <\/script>
      </body>
      </html>
    `);
    printWindow.document.close();
  };

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const activeCount = tables.filter((t) => t.is_active).length;

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pb-24 pt-4">
      <div className="space-y-6">
        {/* Header */}
        <div className="mb-6">
          <Link to="/merchant" className="text-xs text-muted-foreground hover:text-foreground">
            ← Dashboard
          </Link>
          <h1 className="font-display mt-2 text-3xl text-foreground">Tables & QR Codes</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {tables.length} tables · {activeCount} active
          </p>
        </div>

        {/* Table ordering toggle */}
        <div className="glass-strong mb-6 rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-foreground">Table Ordering</p>
              <p className="text-xs text-muted-foreground">
                Let customers scan table QR codes to order
              </p>
            </div>
            <button
              onClick={handleToggleTableOrdering}
              disabled={togglingSetting}
              className="flex items-center"
            >
              {profile?.table_ordering_enabled ? (
                <ToggleRight className="h-10 w-10 text-green-500" />
              ) : (
                <ToggleLeft className="h-10 w-10 text-muted-foreground" />
              )}
            </button>
          </div>
        </div>

        {/* Generate tables */}
        <div className="glass-strong mb-6 rounded-2xl p-5">
          <p className="font-medium text-foreground mb-3">Generate Tables</p>
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <label className="text-xs text-muted-foreground">Name prefix</label>
              <input
                type="text"
                value={generatePrefix}
                onChange={(e) => setGeneratePrefix(e.target.value)}
                className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
                placeholder="Table"
              />
            </div>
            <div className="w-24">
              <label className="text-xs text-muted-foreground">Count</label>
              <input
                type="number"
                min={1}
                max={200}
                value={generateCount}
                onChange={(e) => setGenerateCount(parseInt(e.target.value) || 1)}
                className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
              />
            </div>
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="flex h-10 items-center gap-2 rounded-xl bg-foreground px-4 text-sm font-medium text-background disabled:opacity-50"
            >
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Generate
            </button>
          </div>
        </div>

        {/* Table list */}
        {tables.length === 0 ? (
          <div className="glass-strong rounded-2xl p-10 text-center">
            <QrCode className="mx-auto h-12 w-12 text-muted-foreground/30" />
            <p className="mt-3 text-sm text-muted-foreground">No tables yet. Generate tables above to get started.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {tables.map((table) => (
              <div
                key={table.id}
                className={`glass-strong rounded-2xl p-4 ${!table.is_active ? "opacity-50" : ""}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-sm font-bold text-primary">
                      {table.table_number}
                    </div>
                    <div>
                      <p className="font-medium text-foreground">{table.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {table.is_active ? "Active" : "Inactive"} · Token: {table.public_token.slice(0, 12)}...
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setQrPreview(table)}
                      className="rounded-lg p-2 hover:bg-muted"
                      title="Preview QR"
                    >
                      <QrCode className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => downloadQR(table)}
                      className="rounded-lg p-2 hover:bg-muted"
                      title="Download QR"
                    >
                      <Download className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handlePrintQR(table)}
                      className="rounded-lg p-2 hover:bg-muted"
                      title="Print QR"
                    >
                      <Printer className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => {
                        setEditingTable(table);
                        setEditName(table.name);
                      }}
                      className="rounded-lg p-2 hover:bg-muted"
                      title="Rename"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleToggleActive(table)}
                      className="rounded-lg p-2 hover:bg-muted"
                      title={table.is_active ? "Deactivate" : "Activate"}
                    >
                      {table.is_active ? (
                        <ToggleRight className="h-4 w-4 text-green-500" />
                      ) : (
                        <ToggleLeft className="h-4 w-4 text-muted-foreground" />
                      )}
                    </button>
                    <button
                      onClick={() => handleRegenerateQR(table)}
                      className="rounded-lg p-2 hover:bg-muted"
                      title="Regenerate QR"
                    >
                      <RefreshCw className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(table.id)}
                      className="rounded-lg p-2 hover:bg-destructive/10 hover:text-destructive"
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                {/* Hidden QR for download */}
                <div id={`qr-${table.id}`} className="hidden">
                  <QRCodeSVG value={getTableQRUrl(table)} size={300} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Rename modal */}
      {editingTable && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-5">
          <div className="w-full max-w-sm rounded-2xl bg-background p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-lg text-foreground">Rename Table</h3>
              <button onClick={() => setEditingTable(null)} className="rounded-lg p-1 hover:bg-muted">
                <X className="h-5 w-5" />
              </button>
            </div>
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
              placeholder="Table name"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && handleRename()}
            />
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setEditingTable(null)}
                className="flex-1 rounded-xl border border-border px-4 py-2 text-sm font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleRename}
                className="flex-1 rounded-xl bg-foreground px-4 py-2 text-sm font-medium text-background"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* QR Preview modal */}
      {qrPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-5">
          <div className="w-full max-w-sm rounded-2xl bg-background p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-lg text-foreground">{qrPreview.name}</h3>
              <button onClick={() => setQrPreview(null)} className="rounded-lg p-1 hover:bg-muted">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex flex-col items-center gap-4">
              <p className="text-xs text-muted-foreground text-center">
                {profile?.business_name} · {qrPreview.name}
              </p>
              <div className="rounded-2xl bg-white p-4">
                <QRCodeSVG value={getTableQRUrl(qrPreview)} size={200} />
              </div>
              <p className="text-[11px] text-muted-foreground text-center break-all">
                {getTableQRUrl(qrPreview)}
              </p>
              <div className="flex gap-2 w-full">
                <button
                  onClick={() => {
                    downloadQR(qrPreview);
                  }}
                  className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-medium"
                >
                  <Download className="h-4 w-4" /> Download
                </button>
                <button
                  onClick={() => handlePrintQR(qrPreview)}
                  className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-foreground px-4 py-2 text-sm font-medium text-background"
                >
                  <Printer className="h-4 w-4" /> Print
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
