<script lang="ts">
  // Small stroke icons (24 px grid), inline so the app stays one file.
  const PATHS: Record<string, string> = {
    overview: "M4 5h7v6H4zM13 5h7v4h-7zM13 11h7v8h-7zM4 13h7v6H4z",
    inputs: "M3 12h10M9 8l4 4-4 4M15 5h4a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-4",
    mixer: "M6 4v16M12 4v16M18 4v16M4 9h4M10 15h4M16 7h4",
    filters: "M3 15c3 0 4-8 7-8s3 9 6 9 2-4 5-4",
    delay: "M12 7v5l3 2M12 3a9 9 0 1 0 9 9",
    outputs: "M11 5 6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13",
    modc: "M4 6h6v5H4zM14 13h6v5h-6zM10 8.5h4v7M14 15.5h0",
    presets: "M5 4h14v16l-7-4-7 4z",
    diagnose: "M3 12h4l2-6 4 12 2-6h6",
    firmware: "M7 7h10v10H7zM10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4",
    console: "M4 5h16v14H4zM7 9l3 3-3 3M12 15h5",
    usb: "M12 3v14M12 3l-2 3h4zM8 10v3l4 2M16 8v4l-4 2M12 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4",
    sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5",
    menu: "M4 7h16M4 12h16M4 17h16",
    link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
    refresh: "M20 11a8 8 0 0 0-14-4L4 9M4 4v5h5M4 13a8 8 0 0 0 14 4l2-2M20 20v-5h-5",
  };
  let { name, size = 18 }: { name: string; size?: number } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={PATHS[name] ?? ""} /></svg>
