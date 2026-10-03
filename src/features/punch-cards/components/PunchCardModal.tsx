import React, { useState } from "react";
import { MerchantPunchCard } from "@/lib/api";
import { Modal, FL, inputCls } from "@/components/LoyaltyShared";
import { Upload, Image as ImageIcon, Smile, Palette } from "lucide-react";

const EMOJI_PRESETS = [
  "☕",
  "🍵",
  "🥐",
  "🍕",
  "🍔",
  "🧁",
  "🍩",
  "🌮",
  "🎁",
  "⭐",
  "🔥",
  "💎",
  "🎯",
  "🎉",
  "❤️",
  "✨",
];

export function PunchCardModal({
  initial,
  saving,
  onSave,
  onClose,
}: {
  initial: MerchantPunchCard | null;
  saving: boolean;
  onSave: (d: Partial<MerchantPunchCard>) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [mode, setMode] = useState(initial?.mode ?? "per_order");
  const [stampsRequired, setStamps] = useState(String(initial?.stamps_required ?? 5));
  const [rewardText, setRewardText] = useState(initial?.reward_text ?? "");
  const [stampIcon, setStampIcon] = useState(initial?.stamp_icon ?? "☕");
  const [stampGifUrl, setStampGifUrl] = useState(initial?.stamp_gif_url ?? "");
  const [colorScheme, setColorScheme] = useState(initial?.color_scheme ?? "#1e293b");
  const [backgroundImage, setBackgroundImage] = useState(initial?.background_image ?? "");
  const [animatedGif, setAnimatedGif] = useState(initial?.animated_gif_background ?? "");
  const [logo, setLogo] = useState(initial?.logo ?? "");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  const previewStamps = Number(stampsRequired) || 5;
  const previewFilled = 0;

  return (
    <Modal title={initial ? "Edit punch card" : "New punch card"} onClose={onClose}>
      <div className="space-y-4 max-h-[80vh] overflow-y-auto px-1 pb-1">
        {/* Live Preview */}
        <div
          className="rounded-3xl bg-white p-5 shadow-[0_8px_30px_rgba(0,0,0,0.06)]"
          style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="h-5 w-5 rounded border border-gray-200 flex items-center justify-center">
                <ImageIcon className="h-3 w-3 text-gray-400" />
              </div>
              <span className="text-[15px] font-semibold text-[#202124]">Punch Card</span>
            </div>
            <span className="text-[15px] font-medium text-[#6B7280]">
              {previewFilled} / {previewStamps} punches
            </span>
          </div>

          {/* Punch strip with background */}
          <div
            className="relative h-[52px] rounded-full overflow-hidden"
            style={{
              backgroundImage:
                backgroundImage || animatedGif
                  ? `url(${animatedGif || backgroundImage})`
                  : undefined,
              backgroundSize: "cover",
              backgroundPosition: "center",
              backgroundColor: animatedGif || backgroundImage ? undefined : colorScheme,
            }}
          >
            {!backgroundImage && !animatedGif && (
              <div className="absolute inset-0" style={{ backgroundColor: colorScheme }} />
            )}
            <div className="relative flex items-center justify-between h-full px-3">
              {Array.from({ length: previewStamps }).map((_, i) => {
                const filled = i < previewFilled;
                return (
                  <div
                    key={i}
                    className="w-[30px] h-[30px] rounded-full flex items-center justify-center text-[13px] font-medium"
                    style={{
                      background: filled ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.75)",
                      backdropFilter: filled ? undefined : "blur(8px)",
                      color: filled ? colorScheme : "#6B7280",
                      boxShadow: filled ? "0 2px 8px rgba(0,0,0,0.15)" : undefined,
                    }}
                  >
                    {filled ? (
                      stampGifUrl ? (
                        <img
                          src={stampGifUrl}
                          alt=""
                          className="w-5 h-5 rounded-full object-cover"
                        />
                      ) : (
                        stampIcon
                      )
                    ) : (
                      i + 1
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Progress bar */}
          <div className="mt-3 h-[5px] rounded-full bg-[#ECECEC] overflow-hidden">
            <div
              className="h-full rounded-full bg-[#111111] transition-all"
              style={{ width: `${(previewFilled / previewStamps) * 100}%` }}
            />
          </div>

          {/* Reward card */}
          <div className="mt-4 rounded-[22px] bg-[#F5F3F0] p-4">
            <div className="flex items-center justify-between">
              <span className="text-[18px] font-semibold text-[#202124]">
                {rewardText || "Get a reward"}
              </span>
              <span className="text-[15px] font-medium text-gray-500">
                {previewStamps - previewFilled > 0
                  ? `${previewStamps - previewFilled} more`
                  : "Done!"}
              </span>
            </div>
            <p className="mt-1 text-[14px] text-[#7B7B7B]">
              {previewStamps} punches → 🎁 {rewardText || "Free reward"}
            </p>
          </div>
        </div>

        {/* ── Basic Info ── */}
        <FL label="Card name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Free Coffee Card"
            className={inputCls}
          />
        </FL>
        <FL label="Reward text">
          <input
            value={rewardText}
            onChange={(e) => setRewardText(e.target.value)}
            placeholder="e.g. Free Iced Latte"
            className={inputCls}
          />
        </FL>

        <div className="grid grid-cols-2 gap-3">
          <FL label="Mode">
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as any)}
              className={inputCls}
            >
              <option value="per_order">Per Order</option>
              <option value="per_streak">Per Streak (12h gap)</option>
            </select>
          </FL>
          <FL label="Stamps required">
            <input
              type="number"
              min={1}
              max={20}
              value={stampsRequired}
              onChange={(e) => setStamps(e.target.value)}
              className={inputCls}
            />
          </FL>
        </div>

        {/* ── Stamp Customization ── */}
        <div className="rounded-2xl border border-border p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Smile className="h-4 w-4 text-muted-foreground" /> Stamp Style
          </div>

          <FL label="Stamp Emoji">
            <div className="flex items-center gap-2">
              <input
                value={stampIcon}
                onChange={(e) => setStampIcon(e.target.value)}
                className={`${inputCls} flex-1`}
                maxLength={4}
                placeholder="☕"
              />
              <button
                type="button"
                onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                className="h-10 w-10 shrink-0 rounded-2xl border border-border bg-background flex items-center justify-center text-lg hover:bg-mist transition-colors"
              >
                {stampIcon}
              </button>
            </div>
            {showEmojiPicker && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {EMOJI_PRESETS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => {
                      setStampIcon(emoji);
                      setShowEmojiPicker(false);
                    }}
                    className={`h-9 w-9 rounded-xl flex items-center justify-center text-lg transition-all ${
                      stampIcon === emoji
                        ? "bg-ink text-white scale-110"
                        : "bg-mist hover:bg-gray-200"
                    }`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
          </FL>

          <FL label="Stamp GIF URL (optional — overrides emoji)">
            <input
              value={stampGifUrl}
              onChange={(e) => setStampGifUrl(e.target.value)}
              className={inputCls}
              placeholder="https://example.com/stamp.gif"
            />
          </FL>
        </div>

        {/* ── Background Customization ── */}
        <div className="rounded-2xl border border-border p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <ImageIcon className="h-4 w-4 text-muted-foreground" /> Card Background
          </div>

          <FL label="Background Image URL">
            <input
              value={backgroundImage}
              onChange={(e) => setBackgroundImage(e.target.value)}
              className={inputCls}
              placeholder="https://example.com/bg.jpg"
            />
          </FL>

          <FL label="Animated GIF URL (optional — overrides background)">
            <input
              value={animatedGif}
              onChange={(e) => setAnimatedGif(e.target.value)}
              className={inputCls}
              placeholder="https://example.com/animation.gif"
            />
          </FL>
        </div>

        {/* ── Theme ── */}
        <div className="rounded-2xl border border-border p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Palette className="h-4 w-4 text-muted-foreground" /> Theme
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FL label="Theme Color">
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={colorScheme}
                  onChange={(e) => setColorScheme(e.target.value)}
                  className="h-10 w-10 shrink-0 rounded-xl border border-border cursor-pointer"
                />
                <input
                  value={colorScheme}
                  onChange={(e) => setColorScheme(e.target.value)}
                  className={`${inputCls} flex-1`}
                  placeholder="#1e293b"
                />
              </div>
            </FL>
            <FL label="Logo URL">
              <input
                value={logo}
                onChange={(e) => setLogo(e.target.value)}
                className={inputCls}
                placeholder="https://example.com/logo.png"
              />
            </FL>
          </div>
        </div>

        {/* ── Actions ── */}
        <div className="flex gap-2 pt-2">
          <button
            onClick={onClose}
            className="h-10 flex-1 rounded-2xl border border-border text-sm text-muted-foreground"
          >
            Cancel
          </button>
          <button
            onClick={() =>
              onSave({
                name,
                mode: mode as any,
                stamps_required: Number(stampsRequired),
                reward_text: rewardText,
                stamp_icon: stampIcon,
                stamp_gif_url: stampGifUrl,
                color_scheme: colorScheme,
                background_image: backgroundImage,
                animated_gif_background: animatedGif,
                logo,
                is_active: initial?.is_active ?? true,
              })
            }
            disabled={saving || !name.trim() || !rewardText.trim()}
            className="h-10 flex-1 rounded-2xl bg-ink text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {saving ? "Saving..." : initial ? "Save changes" : "Create"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
