// src/features/preparation/screens/PreparationSettingsScreen.tsx
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { usePosStore } from "@/features/pos/store";
import { useQueryClient } from "@tanstack/react-query";
import { preparationKeys } from "../query-keys";
import * as prepApi from "../api";
import {
  usePreparationSettings,
  useUpdatePreparationSettings,
  usePreparationAreas,
  useCreateArea,
  useDeleteArea,
  useUpdateArea,
  useSetupCafePreset,
  useBulkAssign,
  useMerchantMenuItems,
} from "../hooks";
import type { PreparationArea } from "../types";

export default function PreparationSettingsScreen() {
  const merchant = usePosStore((s) => s.merchant);
  const qc = useQueryClient();
  const { data: settings, isLoading } = usePreparationSettings();
  const { data: areas = [] } = usePreparationAreas();
  const { data: menuItems = [] } = useMerchantMenuItems();

  const toggleMutation = useUpdatePreparationSettings();
  const createArea = useCreateArea();
  const updateArea = useUpdateArea();
  const deleteArea = useDeleteArea();
  const setupPreset = useSetupCafePreset();
  const bulkAssign = useBulkAssign();

  const [newAreaName, setNewAreaName] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");
  const [selectedItems, setSelectedItems] = useState<number[]>([]);
  const [bulkAreaId, setBulkAreaId] = useState<number | null>(null);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-gray-500">Loading preparation settings...</div>
      </div>
    );
  }

  const enabled = settings?.preparation_routing_enabled ?? false;

  const handleToggle = () => {
    toggleMutation.mutate({ preparation_routing_enabled: !enabled });
  };

  const handleAddArea = () => {
    if (!newAreaName.trim()) return;
    createArea.mutate(
      { name: newAreaName.trim(), display_order: areas.length + 1 },
      {
        onSuccess: () => setNewAreaName(""),
      }
    );
  };

  const handleSetupPreset = () => {
    setupPreset.mutate();
  };

  const handleSaveEdit = (id: number) => {
    if (!editingName.trim()) return;
    updateArea.mutate(
      { id, data: { name: editingName.trim() } },
      { onSuccess: () => { setEditingId(null); setEditingName(""); } }
    );
  };

  const handleDelete = (area: PreparationArea) => {
    if (area.is_default && areas.filter((a) => a.is_active).length <= 1) {
      alert("Cannot delete the only active area.");
      return;
    }
    deleteArea.mutate(area.id);
  };

  const handleSetDefault = (area: PreparationArea) => {
    updateArea.mutate({ id: area.id, data: { is_default: true } });
  };

  const handleBulkAssign = () => {
    if (selectedItems.length === 0) return;
    bulkAssign.mutate({
      menu_item_ids: selectedItems,
      preparation_area_id: bulkAreaId,
      requires_preparation: true,
    });
    setSelectedItems([]);
  };

  const toggleItem = (id: number) => {
    setSelectedItems((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const selectAllInCategory = (category: string) => {
    const catItems = menuItems
      .filter((i) => i.category === category)
      .map((i) => i.id);
    setSelectedItems((prev) => [...new Set([...prev, ...catItems])]);
  };

  // Group menu items by category
  const categories = [...new Set(menuItems.map((i) => i.category || "Uncategorized"))];

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-6">
      <h1 className="text-2xl font-bold">Preparation Workflow</h1>

      {/* Toggle Section */}
      <div className="bg-white rounded-lg border p-6">
        <h2 className="text-lg font-semibold mb-4">How are orders prepared?</h2>
        <div className="space-y-3">
          <label className="flex items-start gap-3 p-4 border rounded-lg cursor-pointer hover:bg-gray-50">
            <input
              type="radio"
              name="preparation_mode"
              checked={!enabled}
              onChange={() => enabled && handleToggle()}
              className="mt-1"
            />
            <div>
              <div className="font-medium">Simple preparation</div>
              <div className="text-sm text-gray-500">
                Send the complete order to one order screen. Best for smaller cafés and single-counter businesses.
              </div>
            </div>
          </label>

          <label className="flex items-start gap-3 p-4 border rounded-lg cursor-pointer hover:bg-gray-50">
            <input
              type="radio"
              name="preparation_mode"
              checked={enabled}
              onChange={() => !enabled && handleToggle()}
              className="mt-1"
            />
            <div>
              <div className="font-medium">Separate preparation areas</div>
              <div className="text-sm text-gray-500">
                Route products to teams such as Bar, Kitchen or Bakery. Best for businesses with separate preparation areas.
              </div>
            </div>
          </label>
        </div>
      </div>

      {/* Area Management (shown when routing enabled or areas exist) */}
      {(enabled || areas.length > 0) && (
        <div className="bg-white rounded-lg border p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Preparation Areas</h2>
            {areas.length === 0 && (
              <button
                onClick={handleSetupPreset}
                disabled={setupPreset.isPending}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
              >
                {setupPreset.isPending ? "Setting up..." : "Use Café Setup"}
              </button>
            )}
          </div>

          <p className="text-sm text-gray-500 mb-4">
            Use Café Setup creates: Bar, Kitchen, and Main Counter (default).
          </p>

          {/* Add new area */}
          <div className="flex gap-2 mb-4">
            <input
              type="text"
              value={newAreaName}
              onChange={(e) => setNewAreaName(e.target.value)}
              placeholder="New area name (e.g. Bakery)"
              className="flex-1 px-3 py-2 border rounded-lg text-sm"
              onKeyDown={(e) => e.key === "Enter" && handleAddArea()}
            />
            <button
              onClick={handleAddArea}
              disabled={!newAreaName.trim() || createArea.isPending}
              className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 disabled:opacity-50"
            >
              Add
            </button>
          </div>

          {/* Areas list */}
          <div className="space-y-2">
            {areas.filter((a) => a.is_active).map((area) => (
              <div
                key={area.id}
                className="flex items-center justify-between p-3 border rounded-lg"
              >
                <div className="flex items-center gap-3">
                  {editingId === area.id ? (
                    <input
                      type="text"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      className="px-2 py-1 border rounded text-sm"
                      onKeyDown={(e) => e.key === "Enter" && handleSaveEdit(area.id)}
                      autoFocus
                    />
                  ) : (
                    <span className="font-medium">{area.name}</span>
                  )}
                  {area.is_default && (
                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                      Default
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {editingId === area.id ? (
                    <>
                      <button
                        onClick={() => handleSaveEdit(area.id)}
                        className="text-green-600 text-sm hover:underline"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => { setEditingId(null); setEditingName(""); }}
                        className="text-gray-500 text-sm hover:underline"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      {!area.is_default && (
                        <button
                          onClick={() => handleSetDefault(area)}
                          className="text-blue-600 text-sm hover:underline"
                        >
                          Set Default
                        </button>
                      )}
                      <button
                        onClick={() => { setEditingId(area.id); setEditingName(area.name); }}
                        className="text-gray-600 text-sm hover:underline"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(area)}
                        className="text-red-600 text-sm hover:underline"
                      >
                        Remove
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Menu Item Assignment (shown when routing enabled and areas exist) */}
      {enabled && areas.length > 0 && (
        <div className="bg-white rounded-lg border p-6">
          <h2 className="text-lg font-semibold mb-2">Assign Menu Items</h2>
          <p className="text-sm text-gray-500 mb-4">
            {settings?.stats?.assigned_items ?? 0} products assigned · {" "}
            {settings?.stats?.unassigned_items ?? 0} will use the default area
          </p>

          {/* Bulk assign controls */}
          <div className="flex items-center gap-3 mb-4 p-3 bg-gray-50 rounded-lg">
            <span className="text-sm text-gray-600">
              {selectedItems.length} selected
            </span>
            <select
              value={bulkAreaId ?? ""}
              onChange={(e) =>
                setBulkAreaId(e.target.value ? Number(e.target.value) : null)
              }
              className="px-3 py-1 border rounded text-sm"
            >
              <option value="">No area (use default)</option>
              {areas.filter((a) => a.is_active).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <button
              onClick={handleBulkAssign}
              disabled={selectedItems.length === 0 || bulkAssign.isPending}
              className="px-3 py-1 bg-indigo-600 text-white rounded text-sm hover:bg-indigo-700 disabled:opacity-50"
            >
              Assign Selected
            </button>
            <button
              onClick={() => setSelectedItems([])}
              className="text-gray-500 text-sm hover:underline"
            >
              Clear
            </button>
          </div>

          {/* Menu items by category */}
          <div className="space-y-4">
            {categories.map((cat) => {
              const catItems = menuItems.filter(
                (i) => (i.category || "Uncategorized") === cat
              );
              return (
                <div key={cat}>
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="font-medium text-sm text-gray-700">{cat}</h3>
                    <button
                      onClick={() => selectAllInCategory(cat)}
                      className="text-xs text-indigo-600 hover:underline"
                    >
                      Select all in {cat}
                    </button>
                  </div>
                  <div className="space-y-1">
                    {catItems.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between p-2 hover:bg-gray-50 rounded"
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={selectedItems.includes(item.id)}
                            onChange={() => toggleItem(item.id)}
                            className="rounded"
                          />
                          <span className="text-sm">
                            {item.emoji} {item.name}
                          </span>
                          {!item.requires_preparation && (
                            <span className="text-xs text-gray-400">
                              (no prep)
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <select
                            value={item.preparation_area ?? ""}
                            onChange={(e) => {
                              const val = e.target.value;
                              prepApi.updateMenuItemPreparation(item.id, {
                                preparation_area: val ? Number(val) : null,
                                requires_preparation: item.requires_preparation,
                              }).then(() => {
                                qc.invalidateQueries({ queryKey: preparationKeys.menuItems() });
                                qc.invalidateQueries({ queryKey: preparationKeys.settings() });
                              });
                            }}
                            className="px-2 py-1 border rounded text-xs"
                          >
                            <option value="">Default</option>
                            {areas.filter((a) => a.is_active).map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.name}
                              </option>
                            ))}
                          </select>
                          <label className="flex items-center gap-1 text-xs text-gray-500">
                            <input
                              type="checkbox"
                              checked={item.requires_preparation}
                              onChange={(e) => {
                                prepApi.updateMenuItemPreparation(item.id, {
                                  preparation_area: item.preparation_area,
                                  requires_preparation: e.target.checked,
                                }).then(() => {
                                  qc.invalidateQueries({ queryKey: preparationKeys.menuItems() });
                                  qc.invalidateQueries({ queryKey: preparationKeys.settings() });
                                });
                              }}
                            />
                            Prep
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
