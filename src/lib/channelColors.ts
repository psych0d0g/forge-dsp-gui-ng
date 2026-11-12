// One colour per channel, the same on every page (readable on dark and light):
// outputs 1..8, then the signal sums A/B (35/36).
export const CHANNEL_COLORS = ["#f59e0b", "#10b981", "#ec4899", "#a78bfa", "#22d3ee", "#ef4444", "#84cc16", "#94a3b8", "#fb7185", "#38bdf8"];
export const channelColor = (ch: number) =>
  CHANNEL_COLORS[(ch > 30 ? 8 + (ch - 35) : ch - 1 + CHANNEL_COLORS.length) % CHANNEL_COLORS.length];
